import joplin from 'api';
import { TextEmbeddingModel, TextGenerationModel } from '../models/models';
import { find_nearest_notes } from '../notes/embeddings';
import { JarvisSettings } from '../ux/settings';
import { get_all_tags, split_by_tokens } from '../utils';

export async function annotate_title(model_gen: TextGenerationModel,
  settings: JarvisSettings, text: string = '') {
  // 为当前笔记生成标题
  // 如果 text 为空，则使用笔记正文
  if (model_gen.model === null) { return; }
  const note = await joplin.workspace.selectedNote();
  if (!note) {
    return;
  }

  if (text.length === 0) {
    const text_tokens = model_gen.max_tokens - model_gen.count_tokens(settings.prompts.title) - 30;
    text = split_by_tokens([note.body], model_gen, text_tokens, 'first')[0].join(' ');
  }
  // 获取当前标题中的第一个数字或日期
  let title = note.title.match(/^[\d-/.]+/);
  if (title) { title = title[0] + ' '; } else { title = ''; }

  const prompt = `笔记内容\n===\n${text}\n===\n\n指令\n===\n${settings.prompts.title.replace('{preferred_language}', settings.annotate_preferred_language)}\n===\n\n笔记标题\n===\n`;
  title += await model_gen.complete(prompt);
  if (title.slice(-1) === '.') { title = title.slice(0, -1); }

  await joplin.data.put(['notes', note.id], null, { title: title });
}

export async function annotate_summary(model_gen: TextGenerationModel,
  settings: JarvisSettings, edit_note: boolean = true): Promise<string> {
  // 生成摘要
  // 将摘要插入笔记（替换现有摘要）
  // 如果 edit_note 为 false，则仅返回摘要
  if (model_gen.model === null) { return; }
  const note = await joplin.workspace.selectedNote();
  if (!note) {
    return;
  }

  const summary_start = '<!-- jarvis-summary-start -->';
  const summary_end = '<!-- jarvis-summary-end -->';
  const find_summary = new RegExp(`${summary_start}[\\s\\S]*?${summary_end}`);

  const text_tokens = model_gen.max_tokens - model_gen.count_tokens(settings.prompts.summary) - 80;
  const text = split_by_tokens([note.body.replace(find_summary, '')], model_gen, text_tokens, 'first')[0].join(' ');

  const prompt = `笔记内容\n===\n${text}\n===\n\n指令\n===\n${settings.prompts.summary.replace('{preferred_language}', settings.annotate_preferred_language)}\n===\n\n笔记摘要\n===\n`;

  const summary = await model_gen.complete(prompt);

  if (!edit_note) { return summary; }

  // 替换现有摘要块，或添加摘要块
  if (note.body.includes(summary_start) &&
    note.body.includes(summary_end)) {
    note.body = note.body.replace(find_summary, `${summary_start}\n${settings.annotate_summary_title}\n${summary}\n${summary_end}`);
  } else {
    note.body = `${summary_start}\n${settings.annotate_summary_title}\n${summary}\n${summary_end}\n\n${note.body}`;
  }

  await joplin.commands.execute('editor.setText', note.body);
  await joplin.data.put(['notes', note.id], null, { body: note.body });
  return summary;
}

export async function annotate_links(model_embed: TextEmbeddingModel, settings: JarvisSettings) {
  if (model_embed.model === null) { return; }
  const note = await joplin.workspace.selectedNote();
  if (!note) {
    return;
  }

  // 语义搜索
  const nearest = await find_nearest_notes(model_embed.embeddings, note.id, note.title, note.body, model_embed, settings);

  // 生成链接
  const links = nearest.map(n => `[${n.title}](:/${n.id})`).join('\n');

  // 替换现有链接块，或添加链接块
  const links_start = '<!-- jarvis-links-start -->';
  const links_end = '<!-- jarvis-links-end -->';
  const find_links = new RegExp(`${links_start}[\\s\\S]*?${links_end}`);
  if (note.body.includes(links_start) &&
    note.body.includes(links_end)) {
    note.body = note.body.replace(find_links, `${links_start}\n${settings.annotate_links_title}\n${links}\n${links_end}`);
  } else {
    note.body = `${note.body}\n\n${links_start}\n${settings.annotate_links_title}\n${links}\n${links_end}`;
  }

  await joplin.commands.execute('editor.setText', note.body);
  await joplin.data.put(['notes', note.id], null, { body: note.body });
}

export async function annotate_tags(model_gen: TextGenerationModel, model_embed: TextEmbeddingModel,
  settings: JarvisSettings, summary: string = '') {
  if (model_gen.model === null) { return; }
  const note = await joplin.workspace.selectedNote();
  if (!note) {
    return;
  }

  let prompt = '';
  let tag_list: string[] = [];
  if (settings.annotate_tags_method === 'unsupervised') {
    prompt = `${settings.prompts.tags} 返回 *最多* ${settings.annotate_tags_max} 个关键字。`;

  } else if (settings.annotate_tags_method === 'from_list') {
    tag_list = await get_all_tags();
    if (tag_list.length == 0) {
      joplin.views.dialogs.showMessageBox('错误：未找到标签');
      return;
    }
    prompt = `${settings.prompts.tags} 返回 *最多* ${settings.annotate_tags_max} 个关键字，从以下关键字库中选择。\n\n关键字库\n===\n${tag_list.join(', ')}\n===`;

  } else if (settings.annotate_tags_method === 'from_notes') {
    if (model_embed.model === null) { return; }
    if (model_embed.embeddings.length == 0) {
      joplin.views.dialogs.showMessageBox('错误：笔记数据库为空');
      return;
    }

    // 语义搜索
    const nearest = await find_nearest_notes(model_embed.embeddings, note.id, note.title, note.body, model_embed, settings);
    // 生成示例
    let notes: string[] = [];
    for (const n of nearest) {
      const tags = (await joplin.data.get(['notes', n.id, 'tags'], { fields: ['title'] }))
        .items.map(t => t.title);
      if (tags.length > 0) {
        tag_list = tag_list.concat(tags);
        notes = notes.concat(`笔记 "${n.title}" 包含以下关键字：${tags.join(', ')}.`);
      }
    }
    if (tag_list.length == 0) { return; }

    prompt = `${settings.prompts.tags} 返回 *最多* ${settings.annotate_tags_max} 个关键字，从以下示例中选择。\n===\n\n关键字示例\n===\n${notes.join('\n')}\n===`;
  }

  // 摘要笔记
  if (summary.length === 0) {
    summary = await annotate_summary(model_gen, settings, false);
  }

  let tags = (await model_gen.complete(
    `笔记内容\n===\n${summary}\n===\n\n指令\n===\n${prompt}\n===\n\n建议的关键字\n===\n`))
    .split(', ').map(tag => tag.trim().toLowerCase());

  // 后处理
  if (tag_list.length > 0) {
    tags = tags.filter(tag => tag_list.includes(tag));
  }
  tags = tags.slice(0, settings.annotate_tags_max);

  await joplin.data.put(['notes', note.id], null, { tags: tags.join(', ') });
}
