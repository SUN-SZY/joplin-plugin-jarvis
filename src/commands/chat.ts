import joplin from 'api';
import { TextEmbeddingModel, TextGenerationModel } from '../models/models';
import { BlockEmbedding, NoteEmbedding, extract_blocks_links, extract_blocks_text, find_nearest_notes, get_nearest_blocks, get_next_blocks, get_prev_blocks } from '../notes/embeddings';
import { update_panel } from '../ux/panel';
import { get_settings, JarvisSettings, ref_notes_prefix, search_notes_cmd, user_notes_cmd, context_cmd, notcontext_cmd } from '../ux/settings';
import { split_by_tokens } from '../utils';

export async function chat_with_jarvis(model_gen: TextGenerationModel) {
  const prompt = await get_chat_prompt(model_gen);

  await replace_selection('\n\n生成响应中...');

  await replace_selection(await model_gen.chat(prompt));
}

export async function chat_with_notes(model_embed: TextEmbeddingModel, model_gen: TextGenerationModel, panel: string, preview: boolean = false) {
  if (model_embed.model === null) { return; }

  const settings = await get_settings();
  const [prompt, nearest] = await get_chat_prompt_and_notes(model_embed, model_gen, settings);
  if (nearest[0].embeddings.length === 0) {
    if (!preview) { await replace_selection(settings.chat_prefix + '未找到笔记。请尝试重新表述你的问题，或开始一个新的聊天笔记以获得新的上下文。' + settings.chat_suffix); }
    return;
  }
  if (!preview) { await replace_selection('\n\n生成笔记响应中...'); }

  const [note_text, selected_embd] = await extract_blocks_text(nearest[0].embeddings, model_gen, model_gen.context_tokens, prompt.search);
  if (note_text === '') {
    if (!preview) { await replace_selection(settings.chat_prefix + '未找到笔记。请尝试重新表述你的问题，或开始一个新的聊天笔记以获得新的上下文。' + settings.chat_suffix); }
    return;
  }
  const note_links = extract_blocks_links(selected_embd);
  let instruct = "根据顶部的用户提示进行回复。你已获得用户笔记。将它们视为自己的知识，不要使用诸如 '根据我的笔记' 这样的修饰语。首先，确定哪些笔记与提示相关，但不要在回复中指定。然后，根据这些选定的笔记编写对提示的回复。在回答的文本中，始终以 [笔记编号] 的格式引用相关笔记。不要在回复的末尾编译参考列表。示例：'这是答案，如 [笔记 1] 所示'。";
  if (settings.notes_prompt) {
    instruct = settings.notes_prompt;
  }

  let completion = await model_gen.chat(`
  ${prompt.prompt}
  ===
  用户提示结束
  ===

  用户笔记
  ===
  ${note_text}
  ===

  指令
  ===
  ${instruct}
  ===
  `, preview);
  if (!preview) { await replace_selection(completion.replace(model_gen.user_prefix, `\n\n${note_links}${model_gen.user_prefix}`)); }
  nearest[0].embeddings = selected_embd;
  update_panel(panel, nearest, settings);
}

type ParsedData = { [key: string]: string };
const cmd_block_pattern: RegExp = /jarvis[\s\S]*?/gm;

export async function get_chat_prompt(model_gen: TextGenerationModel): Promise<string> {
  // 获取光标位置
  const cursor = await joplin.commands.execute('editor.execCommand', {
    name: 'getCursor',
    args: ['from'],
  });
  // 获取光标前的所有文本
  let prompt = await joplin.commands.execute('editor.execCommand', {
    name: 'getRange',
    args: [{ line: 0, ch: 0 }, cursor],
  });
  // 移除聊天命令
  prompt = prompt.replace(cmd_block_pattern, '');
  // 获取最后的标记
  prompt = split_by_tokens([prompt], model_gen, model_gen.memory_tokens, 'last')[0].join(' ');

  return prompt;
}

async function get_chat_prompt_and_notes(model_embed: TextEmbeddingModel, model_gen: TextGenerationModel, settings: JarvisSettings):
    Promise<[{ prompt: string, search: string, notes: Set<string>, context: string, not_context: string[] }, NoteEmbedding[]]> {
  const note = await joplin.workspace.selectedNote();
  const prompt = get_notes_prompt(await get_chat_prompt(model_gen), note, model_gen);

  // 根据提示过滤嵌入
  let sub_embeds: BlockEmbedding[] = [];
  if (prompt.notes.size > 0) {
    sub_embeds.push(...model_embed.embeddings.filter((embd) => prompt.notes.has(embd.id)));
  }
  if (prompt.search) {
    const search_res = await joplin.data.get(['search'], { query: prompt.search, field: ['id'] });
    const search_ids = new Set(search_res.items.map((item) => item.id));
    sub_embeds.push(...model_embed.embeddings.filter((embd) => search_ids.has(embd.id) && !prompt.notes.has(embd.id)));
  }
  if (sub_embeds.length === 0) {
    sub_embeds = model_embed.embeddings;
  } else {
    // 按相似度对笔记进行排名，但不筛选任何笔记
    settings.notes_min_similarity = 0;
  }

  // 获取嵌入
  if (prompt.context && prompt.context.length > 0) {
    // 用用户定义的上下文替换当前笔记
    note.body = prompt.context;
  } else {
    // 使用 X 个最后一个用户提示作为上下文
    const chat = model_gen._parse_chat(prompt.prompt)
      .filter((msg) => msg.role === 'user');
    if (chat.length > 0) {
      note.body = chat.slice(-settings.notes_context_history).map((msg) => msg.content).join('\n');
    }
  }
  if (prompt.not_context.length > 0) {
    // 从上下文中移除
    for (const nc of prompt.not_context) {
      note.body = note.body.replace(new RegExp(nc, 'g'), '');
    }
  }
  const nearest = await find_nearest_notes(sub_embeds, note.id, note.title, note.body, model_embed, settings, false);
  if (nearest.length === 0) {
    nearest.push({ id: note.id, title: '聊天上下文', embeddings: [], similarity: null });
  }

  // 后处理：附加其他块到最近的笔记
  let attached: Set<string> = new Set();
  let blocks: BlockEmbedding[] = [];
  for (const embd of nearest[0].embeddings) {
    // bid 是笔记 ID 和块行号的连接（例如 'note_id:1234'）
    const bid = `${embd.id}:${embd.line}`;
    if (attached.has(bid)) {
      continue;
    }
    // TODO: 重新考虑是否确实应该跳过整个迭代

    if (settings.notes_attach_prev > 0) {
      const prev = await get_prev_blocks(embd, model_embed.embeddings, settings.notes_attach_prev);
      // 按反向顺序推送
      for (let i = prev.length - 1; i >= 0; i--) {
        const bid = `${prev[i].id}:${prev[i].line}`;
        if (attached.has(bid)) { continue; }
        attached.add(bid);
        blocks.push(prev[i]);
      }
    }

    // 当前块
    attached.add(bid);
    blocks.push(embd);

    if (settings.notes_attach_next > 0) {
      const next = await get_next_blocks(embd, model_embed.embeddings, settings.notes_attach_next);
      for (let i = 0; i < next.length; i++) {
        const bid = `${next[i].id}:${next[i].line}`;
        if (attached.has(bid)) { continue; }
        attached.add(bid);
        blocks.push(next[i]);
      }
    }

    if (settings.notes_attach_nearest > 0) {
      const nearest = await get_nearest_blocks(embd, model_embed.embeddings, settings, settings.notes_attach_nearest);
      for (let i = 0; i < nearest.length; i++) {
        const bid = `${nearest[i].id}:${nearest[i].line}`;
        if (attached.has(bid)) { continue; }
        attached.add(bid);
        blocks.push(nearest[i]);
      }
    }
  }
  nearest[0].embeddings = blocks;

  return [prompt, nearest];
}

function get_notes_prompt(prompt: string, note: any, model_gen: TextGenerationModel):
    { prompt: string, search: string, notes: Set<string>, context: string, not_context: string[] } {
  // 获取全局命令
  const commands = get_global_commands(note.body);
  note.body = note.body.replace(cmd_block_pattern, '');

  // (之前的响应) 去除以 {ref_notes_prefix} 开头的行
  prompt = prompt.replace(new RegExp('^' + ref_notes_prefix + '.*$', 'gm'), '');
  const chat = model_gen._parse_chat(prompt);
  let last_user_prompt = '';
  if (chat[chat.length - 1].role === 'user') {
    last_user_prompt = chat[chat.length - 1].content;
  }

  // (用户输入) 解析以 {search_notes_cmd} 开头的行，并从提示中移除它们
  let search = commands[search_notes_cmd.slice(0, -1).toLocaleLowerCase()];  // 最后一个搜索字符串
  const search_regex = new RegExp('^' + search_notes_cmd + '.*$', 'igm');
  prompt = prompt.replace(search_regex, '');
  let matches = last_user_prompt.match(search_regex);
  if (matches !== null) {
    search = matches[matches.length - 1].substring(search_notes_cmd.length).trim();
  };

  // (用户输入) 解析以 {user_notes_cmd} 开头的行，并从提示中移除它们
  const global_ids = commands[user_notes_cmd.slice(0, -1).toLocaleLowerCase()];
  let note_ids: string[] = [];
  if (global_ids) {
    note_ids = global_ids.match(/[a-zA-Z0-9]{32}/g);
  }
  const notes_regex = new RegExp('^' + user_notes_cmd + '.*$', 'igm');
  prompt = prompt.replace(notes_regex, '');
  matches = last_user_prompt.match(notes_regex);
  if (matches !== null) {
    // 获取所有笔记 ID（32 个字母数字字符）
    note_ids = matches[matches.length - 1].match(/[a-zA-Z0-9]{32}/g);
  }
  const notes = new Set(note_ids);

  // (用户输入) 解析以 {context_cmd} 开头的行，并从提示中移除它们
  let context = commands[context_cmd.slice(0, -1).toLocaleLowerCase()];  // 最后一个上下文字符串
  const context_regex = new RegExp('^' + context_cmd + '.*$', 'igm');
  prompt = prompt.replace(context_regex, '');
  matches = last_user_prompt.match(context_regex);
  if (matches !== null) {
    context = matches[matches.length - 1].substring(context_cmd.length).trim();
  }

  // (用户输入) 解析以 {notcontext_cmd} 开头的行，并仅移除命令本身
  let not_context: string[] = [];  // 所有 not_context 字符串（稍后排除）
  const remove_cmd = new RegExp('^' + notcontext_cmd, 'igm');
  const get_line = new RegExp('^' + notcontext_cmd + '.*$', 'igm');
  matches = prompt.match(get_line);
  if (matches !== null) {
    matches.forEach((match) => {
      not_context.push(match.substring(notcontext_cmd.length).trim());
    });
  }
  prompt = prompt.replace(remove_cmd, '');
  const last_match = last_user_prompt.match(get_line);
  const global_match = commands[notcontext_cmd.slice(0, -1).toLocaleLowerCase()];
  if ((last_match === null) && global_match) {
    // 最后一个用户提示不包含 not_context 命令
    // 将全局 not_context 命令添加到提示中
    prompt += '\n' + global_match;
  }

  return { prompt, search, notes, context, not_context };
}

function get_global_commands(text: string): ParsedData {
  // 定义一个正则表达式模式来匹配代码块
  const cmd_block_match: RegExpMatchArray | null = text.match(cmd_block_pattern);

  // 如果没有找到代码块，则返回一个空对象和原始字符串
  if (!cmd_block_match) return {};

  const cmd_block: string = cmd_block_match[0];

  // 移除开始和结束标签
  const cleaned_cmd_block: string = cmd_block.replace(/jarvis|/g, '');

  // 按行分割
  const lines: string[] = cleaned_cmd_block.split('\n');

  // 定义一个对象来存储解析后的数据
  let parsed_data: ParsedData = {};

  // 遍历每一行并解析键/值对
  lines.forEach((line: string) => {
    // 如果行中不包含冒号，则跳过
    if (!line.includes(':')) return;

    let split_line: string[] = line.split(':');
    if (split_line.length > 1) {
      let key: string = split_line[0].trim().toLowerCase();
      let value: string = split_line.slice(1).join(':').trim();
      parsed_data[key] = value;
    }
  });

  return parsed_data;
}

export async function replace_selection(text: string) {
  // 这适用于富文本编辑器和 CodeMirror 5/6
  await joplin.commands.execute('replaceSelection', text);

  // 等待 0.5 秒以更新笔记
  await new Promise((resolve) => setTimeout(resolve, 500));

  // 清理笔记中的短语
  const phrases = [
    '\n\n生成响应中...',
    '\n\n生成笔记响应中...',
    '\n\n生成自动补全中....'
  ];
  if (!phrases.includes(text)) {
    const note = await joplin.workspace.selectedNote();

    let newBody = note.body;
    for (const phrase of phrases) {
      newBody = newBody.replace(phrase, '');
    }

    await joplin.commands.execute('editor.setText', newBody);
    await joplin.data.put(['notes', note.id], null, { body: newBody });
  }
}
