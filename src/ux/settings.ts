import joplin from 'api';
import { SettingItemType } from 'api/types';
import prompts = require('../assets/prompts.json');

export const ref_notes_prefix = '引用笔记:';
export const search_notes_cmd = '搜索:';
export const user_notes_cmd = '笔记:';
export const context_cmd = '上下文:';
export const notcontext_cmd = '非上下文:';
export const title_separator = ' ::: ';

export interface JarvisSettings {
  // APIs
  openai_api_key: string;
  hf_api_key: string;
  google_api_key: string;
  scopus_api_key: string;
  springer_api_key: string;
  // OpenAI
  model: string;
  chat_timeout: number;
  chat_system_message: string;
  chat_openai_model_id: string;
  chat_openai_model_type: boolean;
  chat_openai_endpoint: string;
  chat_hf_model_id: string;
  chat_hf_endpoint: string;
  temperature: number;
  max_tokens: number;
  memory_tokens: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
  include_prompt: boolean;
  // related notes
  /// model
  notes_model: string;
  notes_parallel_jobs: number;
  notes_max_tokens: number;
  notes_context_tokens: number;
  notes_openai_model_id: string;
  notes_openai_endpoint: string;
  notes_hf_model_id: string;
  notes_hf_endpoint: string;
  /// chunks
  notes_embed_title: boolean;
  notes_embed_path: boolean;
  notes_embed_heading: boolean;
  notes_embed_tags: boolean;
  /// other
  notes_db_update_delay: number;
  notes_include_code: boolean;
  notes_include_links: number;
  notes_min_similarity: number;
  notes_min_length: number;
  notes_max_hits: number;
  notes_context_history: number;
  notes_search_box: boolean;
  notes_prompt: string;
  notes_attach_prev: number;
  notes_attach_next: number;
  notes_attach_nearest: number;
  notes_agg_similarity: string;
  notes_exclude_folders: Set<string>;
  notes_panel_title: string;
  notes_panel_user_style: string;
  // annotations
  annotate_preferred_language: string;
  annotate_title_flag: boolean;
  annotate_summary_flag: boolean;
  annotate_summary_title: string;
  annotate_links_flag: boolean;
  annotate_links_title: string;
  annotate_tags_flag: boolean;
  annotate_tags_method: string;
  annotate_tags_max: number;
  // research
  paper_search_engine: string;
  use_wikipedia: boolean;
  include_paper_summary: boolean;
  // prompts
  instruction: string;
  scope: string;
  role: string;
  reasoning: string;
  prompts: { [prompt: string] : string; };
  // chat
  chat_prefix: string;
  chat_suffix: string;
};

export const model_max_tokens: { [model: string] : number; } = {
  'gpt-4o-mini': 128000,
  'gpt-4o': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4-32k': 32768,
  'gpt-4': 8192,
  'gpt-3.5-turbo': 16384,
  'gpt-3.5-turbo-instruct': 4096,
  'gemini-1.0-pro-latest': 30720,
  'gemini-1.5-pro-latest': 1048576,
};

export const search_engines: { [engine: string] : string; } = {
  'Semantic Scholar': 'Semantic Scholar',
  'Scopus': 'Scopus',
};

export const search_prompts: { [engine: string] : string; } = {
  'Scopus': `
    接下来，根据问题和提示生成几个有效的 Scopus 搜索查询，使用标准的 Scopus 操作符。
    尝试使用多种搜索策略。例如，如果要求比较主题 A 和 B，可以搜索 ("A" AND "B")，
    也可以搜索 ("A" OR "B") 然后比较结果。
    仅在提示中明确要求时，可以使用其他操作符来过滤结果，如出版年份、语言、学科领域或 DOI（如果提供）。
    尽量保持搜索查询简短且不具体（考虑模糊性）。`,
  'Semantic Scholar': `
    接下来，根据问题和提示生成几个有效的 Semantic Scholar 搜索查询，通过用 "+" 连接几个关键词。
    尝试使用多种搜索策略。例如，如果要求比较主题 A 和 B，可以搜索 A+B，
    也可以分别搜索 A 或 B 然后比较结果。
    仅在提示中明确要求时，可以使用其他字段来过滤结果，如 &year=, &publicationTypes=, &fieldsOfStudy=。
    保持搜索查询简短且不具体。`,
};

const title_prompt = `将以下笔记总结为一个句子的标题，该句子用 {preferred_language} 表达，并且能够概括笔记的主要结论或想法。`;
const summary_prompt = `将以下笔记总结为一个简短段落，用 {preferred_language} 表达，包含 2-4 句话，能够以简洁的方式概括笔记的主要结论或想法。`;
const tags_prompt = {
  'unsupervised': `根据内容为以下笔记建议关键词，这些关键词应使笔记更容易找到，并且应简短且简洁（首选单个词关键词）。另外选择一个描述笔记类型的关键词（例如：文章、日记、评论、指南、项目等）。将所有关键词放在一行中，用逗号分隔。`,
  'from_list': `根据内容为以下笔记建议关键词，这些关键词应使笔记更容易找到，并且应简短且简洁。重要的是：您只能从下面的银行中建议关键词。`,
  'from_notes': `根据内容为以下笔记建议关键词，这些关键词应使笔记更容易找到，并且应简短且简洁。下面是一些内容相似的笔记及其关键词示例。您只能从下面的示例中建议关键词。`,
};

export function parse_dropdown_json(json: any, selected?: string): string {
  let options = '';
  for (let [key, value] of Object.entries(json)) {
    // 添加 "selected" 如果 value 等于 selected
    if (selected && value == selected) {
      options += `<option value="${value}" selected>${key}</option>`;
    } else {
      options += `<option value="${value}">${key}</option>`;
    }
  }
  return options;
}

async function parse_dropdown_setting(name: string): Promise<string> {
  const setting = await joplin.settings.value(name);
  const empty = '<option value=""></option>';
  const preset = parse_dropdown_json(prompts[name]);
  try {
    return empty + parse_dropdown_json(JSON.parse(setting)) + preset
  } catch (e) {
    return empty + preset;
  }
}

export async function get_settings(): Promise<JarvisSettings> {
  let model_id = await joplin.settings.value('model');
  if (model_id == 'openai-custom') {
    model_id = await joplin.settings.value('chat_openai_model_id');
    model_id = model_id.replace(/-\d{4}$/, '');  // 移除日期后缀
  }
  // 如果模型在 model_max_tokens 中，使用其值，否则使用设置值
  let max_tokens = model_max_tokens[model_id] || await joplin.settings.value('max_tokens');

  let memory_tokens = await joplin.settings.value('memory_tokens');
  let notes_context_tokens = await joplin.settings.value('notes_context_tokens');
  if (memory_tokens + notes_context_tokens > 0.9*max_tokens) {
    joplin.views.dialogs.showMessageBox(`内存标记 (${memory_tokens}) + 上下文标记 (${notes_context_tokens}) 必须小于最大标记数的 90%。设置已更新 (${Math.floor(0.45*max_tokens)}, ${Math.floor(0.45*max_tokens)})。`);
    memory_tokens = Math.floor(0.45*max_tokens);
    notes_context_tokens = Math.floor(0.45*max_tokens);
    await joplin.settings.setValue('notes_context_tokens', notes_context_tokens);
    await joplin.settings.setValue('memory_tokens', memory_tokens);
  }

  const annotate_tags_method = await joplin.settings.value('annotate_tags_method');

  return {
    // APIs
    openai_api_key: await joplin.settings.value('openai_api_key'),
    hf_api_key: await joplin.settings.value('hf_api_key'),
    google_api_key: await joplin.settings.value('google_api_key'),
    scopus_api_key: await joplin.settings.value('scopus_api_key'),
    springer_api_key: await joplin.settings.value('springer_api_key'),

    // OpenAI
    model: await joplin.settings.value('model'),
    chat_timeout: await joplin.settings.value('chat_timeout'),
    chat_system_message: await joplin.settings.value('chat_system_message'),
    chat_openai_model_id: await joplin.settings.value('chat_openai_model_id'),
    chat_openai_model_type: await joplin.settings.value('chat_openai_model_type'),
    chat_openai_endpoint: await joplin.settings.value('chat_openai_endpoint'),
    chat_hf_model_id: await joplin.settings.value('chat_hf_model_id'),
    chat_hf_endpoint: await joplin.settings.value('chat_hf_endpoint'),
    temperature: (await joplin.settings.value('temp')) / 10,
    max_tokens: max_tokens,
    memory_tokens: await joplin.settings.value('memory_tokens'),
    top_p: (await joplin.settings.value('top_p')) / 100,
    frequency_penalty: (await joplin.settings.value('frequency_penalty')) / 10,
    presence_penalty: (await joplin.settings.value('presence_penalty')) / 10,
    include_prompt: await joplin.settings.value('include_prompt'),

    // related notes
    /// model
    notes_model: await joplin.settings.value('notes_model'),
    notes_parallel_jobs: await joplin.settings.value('notes_parallel_jobs'),
    notes_max_tokens: await joplin.settings.value('notes_max_tokens'),
    notes_context_tokens: notes_context_tokens,
    notes_openai_model_id: await joplin.settings.value('notes_openai_model_id'),
    notes_openai_endpoint: await joplin.settings.value('notes_openai_endpoint'),
    notes_hf_model_id: await joplin.settings.value('notes_hf_model_id'),
    notes_hf_endpoint: await joplin.settings.value('notes_hf_endpoint'),
    /// chunk
    notes_embed_title: await joplin.settings.value('notes_embed_title'),
    notes_embed_path: await joplin.settings.value('notes_embed_path'),
    notes_embed_heading: await joplin.settings.value('notes_embed_heading'),
    notes_embed_tags: await joplin.settings.value('notes_embed_tags'),
    /// other
    notes_db_update_delay: await joplin.settings.value('notes_db_update_delay'),
    notes_include_code: await joplin.settings.value('notes_include_code'),
    notes_include_links: await joplin.settings.value('notes_include_links') / 100,
    notes_min_similarity: await joplin.settings.value('notes_min_similarity') / 100,
    notes_min_length: await joplin.settings.value('notes_min_length'),
    notes_max_hits: await joplin.settings.value('notes_max_hits'),
    notes_context_history: await joplin.settings.value('notes_context_history'),
    notes_search_box: await joplin.settings.value('notes_search_box'),
    notes_prompt: await joplin.settings.value('notes_prompt'),
    notes_attach_prev: await joplin.settings.value('notes_attach_prev'),
    notes_attach_next: await joplin.settings.value('notes_attach_next'),
    notes_attach_nearest: await joplin.settings.value('notes_attach_nearest'),
    notes_agg_similarity: await joplin.settings.value('notes_agg_similarity'),
    notes_exclude_folders: new Set((await joplin.settings.value('notes_exclude_folders')).split(',').map(s => s.trim())),
    notes_panel_title: await joplin.settings.value('notes_panel_title'),
    notes_panel_user_style: await joplin.settings.value('notes_panel_user_style'),
    // annotations
    annotate_preferred_language: await joplin.settings.value('annotate_preferred_language'),
    annotate_tags_flag: await joplin.settings.value('annotate_tags_flag'),
    annotate_summary_flag: await joplin.settings.value('annotate_summary_flag'),
    annotate_summary_title: await joplin.settings.value('annotate_summary_title'),
    annotate_links_flag: await joplin.settings.value('annotate_links_flag'),
    annotate_links_title: await joplin.settings.value('annotate_links_title'),
    annotate_title_flag: await joplin.settings.value('annotate_title_flag'),
    annotate_tags_method: annotate_tags_method,
    annotate_tags_max: await joplin.settings.value('annotate_tags_max'),

    // research
    paper_search_engine: await joplin.settings.value('paper_search_engine'),
    use_wikipedia: await joplin.settings.value('use_wikipedia'),
    include_paper_summary: await joplin.settings.value('include_paper_summary'),

    // prompts
    instruction: await parse_dropdown_setting('instruction'),
    scope: await parse_dropdown_setting('scope'),
    role: await parse_dropdown_setting('role'),
    reasoning: await parse_dropdown_setting('reasoning'),
    prompts: {
      title: (await joplin.settings.value('annotate_title_prompt')) || title_prompt,
      summary: (await joplin.settings.value('annotate_summary_prompt')) || summary_prompt,
      tags: tags_prompt[annotate_tags_method],
    },

    // chat
    chat_prefix: (await joplin.settings.value('chat_prefix')).replace(/\\n/g, '\n'),
    chat_suffix: (await joplin.settings.value('chat_suffix')).replace(/\\n/g, '\n'),
  };
}

export async function register_settings() {
  await joplin.settings.registerSection('jarvis.chat', {
    label: 'Jarvis: 聊天',
    iconName: 'fas fa-robot',
  });
  await joplin.settings.registerSection('jarvis.notes', {
    label: 'Jarvis: 相关笔记',
    iconName: 'fas fa-robot',
  });
  await joplin.settings.registerSection('jarvis.annotate', {
    label: 'Jarvis: 注释',
    iconName: 'fas fa-robot',
  });
  await joplin.settings.registerSection('jarvis.research', {
    label: 'Jarvis: 研究',
    iconName: 'fas fa-robot',
  });

  await joplin.settings.registerSettings({
    'openai_api_key': {
      value: 'YOUR_OPENAI_API_KEY',
      type: SettingItemType.String,
      secure: true,
      section: 'jarvis.chat',
      public: true,
      label: '模型: OpenAI API 密钥',
    },
    'hf_api_key': {
      value: 'YOUR_HF_API_KEY',
      type: SettingItemType.String,
      secure: true,
      section: 'jarvis.chat',
      public: true,
      label: '模型: Hugging Face API 密钥',
    },
    'google_api_key': {
      value: 'YOUR_GOOGLE_API_KEY',
      type: SettingItemType.String,
      secure: true,
      section: 'jarvis.chat',
      public: true,
      label: '模型: Google AI API 密钥',
    },
    'model': {
      value: 'gpt-4o-mini',
      type: SettingItemType.String,
      isEnum: true,
      section: 'jarvis.chat',
      public: true,
      label: '聊天: 模型',
      description: '与 Jarvis 对话/聊天/研究的模型。默认: gpt-4o-mini',
      options: {
        'gpt-4o-mini':'(在线) OpenAI: gpt-4o-mini (128K, 最便宜)',
        'gpt-4o': '(在线) OpenAI: gpt-4o (128K, 更强大)',
        'gpt-3.5-turbo': '(在线) OpenAI: gpt-3.5-turbo (16K, 旧版)',
        'gpt-3.5-turbo-instruct': '(在线) OpenAI: gpt-3.5-turbo-instruct (4K)',
        'openai-custom': '(在线/离线) OpenAI 或兼容: 自定义模型',
        'gemini-1.0-pro-latest': '(在线) Google AI: gemini-1.0-pro-latest (30K)',
        'gemini-1.5-pro-latest': '(在线) Google AI: gemini-1.5-pro-latest (1M)',
        'Hugging Face': '(在线) Hugging Face',
      }
    },
    'chat_timeout': {
      value: 60,
      type: SettingItemType.Int,
      minimum: 0,
      maximum: 600,
      step: 1,
      section: 'jarvis.chat',
      public: true,
      advanced: true,
      label: '聊天: 超时 (秒)',
      description: '等待模型响应的最大时间（秒）。默认: 60',
    },
    'chat_system_message': {
      value: '你就是 Jarvis，乐于助人的助手，而我是用户。',
      type: SettingItemType.String,
      section: 'jarvis.chat',
      public: true,
      advanced: true,
      label: '聊天: 系统消息',
      description: '告知 Jarvis 他是谁、他的目的以及更多关于用户的信息的消息。默认: 你就是 Jarvis，乐于助人的助手，而我是用户。',
    },
    'chat_openai_model_id': {
      value: '',
      type: SettingItemType.String,
      section: 'jarvis.chat',
      public: true,
      advanced: true,
      label: '聊天: OpenAI（或兼容）自定义模型 ID',
      description: '用于文本生成的 OpenAI 模型 ID。默认: 空',
    },
    'chat_openai_model_type': {
      value: true,
      type: SettingItemType.Bool,
      section: 'jarvis.chat',
      public: true,
      advanced: true,
      label: '聊天: 自定义模型是否为对话模型',
      description: '是否使用对话 API 或旧版完成 API。默认: false',
    },
    'chat_openai_endpoint': {
      value: '',
      type: SettingItemType.String,
      section: 'jarvis.chat',
      public: true,
      advanced: true,
      label: '聊天: 自定义模型 API 端点',
      description: "用于文本生成的 OpenAI（或兼容）API 端点。默认为空（OpenAI 的默认公共端点）",
    },
    'chat_hf_model_id': {
      value: 'MBZUAI/LaMini-Flan-T5-783M',
      type: SettingItemType.String,
      section: 'jarvis.chat',
      public: true,
      advanced: true,
      label: '聊天: Hugging Face 文本生成模型 ID',
      description: '用于文本生成的 Hugging Face 模型 ID。默认: MBZUAI/LaMini-Flan-T5-783M',
    },
    'chat_hf_endpoint': {
      value: '',
      type: SettingItemType.String,
      section: 'jarvis.chat',
      public: true,
      advanced: true,
      label: '聊天: Hugging Face API 端点',
      description: "用于文本生成的 Hugging Face API 端点。默认为空（Hugging Face 的默认公共端点）",
    },
    'temp': {
      value: 10,
      type: SettingItemType.Int,
      minimum: 0,
      maximum: 20,
      step: 1,
      section: 'jarvis.chat',
      public: true,
      label: '聊天: 温度',
      description: '模型的温度。0 是最不具创造性的，20 是最具创造性的。较高的值会产生更具创造性的结果，但也可能导致更无意义的文本。默认: 10',
    },
    'max_tokens': {
      value: 2048,
      type: SettingItemType.Int,
      minimum: 128,
      maximum: 32768,
      step: 128,
      section: 'jarvis.chat',
      public: true,
      label: '聊天: 最大标记数',
      description: '所选文本生成/聊天模型的最大上下文长度。此参数仅用于默认上下文长度未知的自定义模型。默认: 2048',
    },
    'memory_tokens': {
      value: 512,
      type: SettingItemType.Int,
      minimum: 128,
      maximum: 16384,
      step: 128,
      section: 'jarvis.chat',
      public: true,
      label: '聊天: 内存标记数',
      description: '与 Jarvis 聊天时保留在内存中的上下文长度。较高的值可能会产生更连贯的对话。必须小于最大标记数的 45%。默认: 512',
    },
    'top_p': {
      value: 100,
      type: SettingItemType.Int,
      minimum: 0,
      maximum: 100,
      step: 1,
      section: 'jarvis.chat',
      public: true,
      label: '聊天: Top P',
      description: '一种替代采样方法，称为核采样，其中模型考虑具有 top_p（介于 0 和 100 之间）概率质量的结果。因此，10 表示只考虑前 10% 概率质量的标记。默认: 100',
    },
    'frequency_penalty': {
      value: 0,
      type: SettingItemType.Int,
      minimum: -20,
      maximum: 20,
      step: 1,
      section: 'jarvis.chat',
      public: true,
      label: '聊天: 频率惩罚',
      description: "一个介于 -20 和 20 之间的值。正值会根据标记在当前文本中的现有频率对新标记进行惩罚，从而降低模型重复相同行的可能性。默认: 0",
    },
    'presence_penalty': {
      value: 0,
      type: SettingItemType.Int,
      minimum: -20,
      maximum: 20,
      step: 1,
      section: 'jarvis.chat',
      public: true,
      label: '聊天: 存在惩罚',
      description: "一个介于 -20 和 20 之间的值。正值会根据标记是否出现在当前文本中对新标记进行惩罚，从而增加模型谈论新话题的可能性。默认: 0",
    },
    'include_prompt': {
      value: false,
      type: SettingItemType.Bool,
      section: 'jarvis.chat',
      public: true,
      label: '聊天: 在响应中包含提示',
      description: '在 Ask Jarvis 的输出中包含给模型的指令。默认: false',
    },
    'notes_model': {
      value: 'Universal Sentence Encoder',
      type: SettingItemType.String,
      isEnum: true,
      section: 'jarvis.notes',
      public: true,
      label: '笔记: 语义相似性模型',
      description: '用于计算文本嵌入的模型。默认: (离线) Universal Sentence Encoder [英语]',
      options: {
        'Universal Sentence Encoder': '(离线) Universal Sentence Encoder [英语]',
        'Hugging Face': '(在线) Hugging Face [多语言]',
        'text-embedding-3-small': '(在线) OpenAI: text-embedding-3-small [多语言]',
        'text-embedding-3-large': '(在线) OpenAI: text-embedding-3-large [多语言]',
        'text-embedding-ada-002': '(在线) OpenAI: text-embedding-ada-002 [多语言]',
        'openai-custom': '(在线) OpenAI 或兼容: 自定义模型',
        'gemini-embedding-001': '(在线) Google AI: embedding-001',
        'gemini-text-embedding-004': '(在线) Google AI: text-embedding-004',
        'ollama': '(离线) Ollama',
      }
    },
    'notes_parallel_jobs': {
      value: 10,
      type: SettingItemType.Int,
      minimum: 1,
      maximum: 50,
      step: 1,
      section: 'jarvis.notes',
      public: true,
      label: '笔记: 并行任务数',
      description: '用于计算文本嵌入的并行任务数。默认: 10',
    },
    'notes_embed_title': {
      value: true,
      type: SettingItemType.Bool,
      section: 'jarvis.notes',
      public: true,
      label: '笔记: 在块中嵌入笔记标题',
      description: '默认: true',
    },
    'notes_embed_path': {
      value: true,
      type: SettingItemType.Bool,
      section: 'jarvis.notes',
      public: true,
      label: '笔记: 在块中嵌入前置标题',
      description: '默认: true',
    },
    'notes_embed_heading': {
      value: true,
      type: SettingItemType.Bool,
      section: 'jarvis.notes',
      public: true,
      label: '笔记: 在块中嵌入最后一个标题',
      description: '默认: true',
    },
    'notes_embed_tags': {
      value: true,
      type: SettingItemType.Bool,
      section: 'jarvis.notes',
      public: true,
      label: '笔记: 在块中嵌入标签',
      description: '默认: true',
    },
    'notes_max_tokens': {
      value: 512,
      type: SettingItemType.Int,
      minimum: 128,
      maximum: 32768,
      step: 128,
      section: 'jarvis.notes',
      public: true,
      label: '笔记: 最大标记数',
      description: '单个笔记块中包含的最大上下文。首选值取决于语义相似性模型的能力。默认: 512',
    },
    'notes_context_tokens': {
      value: 2048,
      type: SettingItemType.Int,
      minimum: 128,
      maximum: 16384,
      step: 128,
      section: 'jarvis.notes',
      public: true,
      label: '笔记: 上下文标记数',
      description: '"与你的笔记聊天"中从笔记中提取的上下文标记数。默认: 2048',
    },
    'notes_context_history': {
      value: 1,
      type: SettingItemType.Int,
      minimum: 1,
      maximum: 20,
      step: 1,
      section: 'jarvis.notes',
      public: true,
      label: '笔记: 上下文历史记录',
      description: '"与你的笔记聊天"中基于用户提示的笔记上下文数量。默认: 1',
    },
    'notes_openai_model_id': {
      value: '',
      type: SettingItemType.String,
      section: 'jarvis.notes',
      public: true,
      advanced: true,
      label: '笔记: OpenAI / Ollama（或兼容）自定义模型 ID',
      description: '用于计算文本嵌入的 OpenAI / Ollama 模型 ID。默认为空',
    },
    'notes_openai_endpoint': {
      value: '',
      type: SettingItemType.String,
      section: 'jarvis.notes',
      public: true,
      advanced: true,
      label: '笔记: OpenAI / Ollama（或兼容）API 端点',
      description: "用于计算文本嵌入的 OpenAI / Ollama API 端点。默认为空（OpenAI 的默认公共端点）",
    },
    'notes_hf_model_id': {
      value: 'sentence-transformers/paraphrase-multilingual-mpnet-base-v2',
      type: SettingItemType.String,
      section: 'jarvis.notes',
      public: true,
      advanced: true,
      label: '笔记: Hugging Face 特征提取模型 ID',
      description: '用于计算文本嵌入的 Hugging Face 模型 ID。默认: sentence-transformers/paraphrase-multilingual-mpnet-base-v2',
    },
    'notes_hf_endpoint': {
      value: '',
      type: SettingItemType.String,
      section: 'jarvis.notes',
      public: true,
      advanced: true,
      label: '笔记: Hugging Face API 端点',
      description: "用于计算文本嵌入的 Hugging Face API 端点。默认为空（Hugging Face 的默认公共端点）",
    },
    'notes_db_update_delay': {
      value: 10,
      type: SettingItemType.Int,
      minimum: 0,
      maximum: 600,
      step: 1,
      section: 'jarvis.notes',
      public: true,
      label: '笔记: 数据库更新周期（分钟）',
      description: '数据库更新之间的周期（分钟）。设置为 0 可禁用自动更新。默认: 10',
    },
    'notes_include_code': {
      value: false,
      type: SettingItemType.Bool,
      section: 'jarvis.notes',
      public: true,
      label: '笔记: 将代码块包含在数据库中',
      description: '默认: false',
    },
    'notes_include_links': {
      value: 0,
      type: SettingItemType.Int,
      minimum: 0,
      maximum: 100,
      step: 1,
      section: 'jarvis.notes',
      public: true,
      label: '笔记: 语义搜索中链接的权重',
      description: '查询笔记中出现的所有链接（合计）在搜索相关笔记时的权重。这也会影响 "与你的笔记聊天" 中选择的笔记。设置为 0 将忽略笔记中出现的链接，而设置为 100 将忽略笔记内容。默认: 0',
    },
    'notes_min_similarity': {
      value: 50,
      type: SettingItemType.Int,
      minimum: 0,
      maximum: 100,
      step: 1,
      section: 'jarvis.notes',
      public: true,
      label: '笔记: 最小笔记相似度',
      description: '默认: 50',
    },
    'notes_min_length': {
      value: 100,
      type: SettingItemType.Int,
      minimum: 0,
      step: 10,
      section: 'jarvis.notes',
      public: true,
      label: '笔记: 包含的最小块长度（字符）',
      description: '默认: 100',
    },
    'notes_max_hits': {
      value: 10,
      type: SettingItemType.Int,
      minimum: 1,
      maximum: 100,
      step: 1,
      section: 'jarvis.notes',
      public: true,
      label: '笔记: 显示的最大笔记数',
      description: '默认: 10',
    },
    'notes_search_box': {
      value: true,
      type: SettingItemType.Bool,
      section: 'jarvis.notes',
      public: true,
      label: '笔记: 显示搜索框',
      description: '默认: true',
    },
    'notes_prompt': {
      value: '',
      type: SettingItemType.String,
      section: 'jarvis.notes',
      public: true,
      advanced: true,
      label: '笔记: 自定义提示',
      description: '用于生成 "与你的笔记聊天" 响应的提示（或附加说明）。默认为空',
    },
    'notes_attach_prev': {
      value: 0,
      type: SettingItemType.Int,
      minimum: 0,
      maximum: 10,
      step: 1,
      section: 'jarvis.notes',
      public: true,
      advanced: true,
      label: '笔记: 添加的前置块数',
      description: '同一笔记中当前块之前出现的前置块。适用于 "与你的笔记聊天"。默认: 0',
    },
    'notes_attach_next': {
      value: 0,
      type: SettingItemType.Int,
      minimum: 0,
      maximum: 10,
      step: 1,
      section: 'jarvis.notes',
      public: true,
      advanced: true,
      label: '笔记: 添加的后置块数',
      description: '同一笔记中当前块之后出现的后置块。适用于 "与你的笔记聊天"。默认: 0',
    },
    'notes_attach_nearest': {
      value: 0,
      type: SettingItemType.Int,
      minimum: 0,
      maximum: 10,
      step: 1,
      section: 'jarvis.notes',
      public: true,
      advanced: true,
      label: '笔记: 添加的最近块数',
      description: '与当前块最相似的块。适用于 "与你的笔记聊天"。默认: 0',
    },
      'notes_agg_similarity': {
          value: 'max',
          type: SettingItemType.String,
          isEnum: true,
          section: 'jarvis.notes',
          public: true,
          label: '笔记: 笔记相似度聚合方法',
          description: '用于根据多个嵌入对笔记进行排名的方法。默认: max',
          options: {
              'max': '最大值',
              'avg': '平均值',
          }
      },
      'annotate_preferred_language': {
          value: 'English',
          type: SettingItemType.String,
          section: 'jarvis.annotate',
          public: true,
          label: '注释: 优先语言',
          description: '生成标题和摘要时使用的优先语言。默认: 英语',
      },
      'annotate_title_flag': {
          value: true,
          type: SettingItemType.Bool,
          section: 'jarvis.annotate',
          public: true,
          label: '注释按钮: 建议标题',
          description: '默认: true',
      },
      'annotate_title_prompt': {
          value: '',
          type: SettingItemType.String,
          section: 'jarvis.annotate',
          public: true,
          advanced: true,
          label: '注释: 自定义标题提示',
          description: '用于生成标题的提示。默认: 空',
      },
      'annotate_summary_flag': {
          value: true,
          type: SettingItemType.Bool,
          section: 'jarvis.annotate',
          public: true,
          label: '注释按钮: 建议摘要',
          description: '默认: true',
      },
      'annotate_summary_prompt': {
          value: '',
          type: SettingItemType.String,
          section: 'jarvis.annotate',
          public: true,
          advanced: true,
          label: '注释: 自定义摘要提示',
          description: '用于生成摘要的提示。默认: 空',
      },
      'annotate_summary_title': {
          value: '# 摘要',
          type: SettingItemType.String,
          section: 'jarvis.annotate',
          public: true,
          advanced: true,
          label: '注释: 摘要部分标题',
          description: '包含建议摘要的部分的标题。默认: # 摘要',
      },
      'annotate_links_flag': {
          value: true,
          type: SettingItemType.Bool,
          section: 'jarvis.annotate',
          public: true,
          label: '注释按钮: 建议链接',
          description: '默认: true',
      },
      'annotate_links_title': {
          value: '# 相关笔记',
          type: SettingItemType.String,
          section: 'jarvis.annotate',
          public: true,
          advanced: true,
          label: '注释: 链接部分标题',
          description: '包含建议链接的部分的标题。默认: # 相关笔记',
      },
      'annotate_tags_flag': {
          value: true,
          type: SettingItemType.Bool,
          section: 'jarvis.annotate',
          public: true,
          label: '注释按钮: 建议标签',
          description: '默认: true',
      },
      'annotate_tags_method': {
          value: 'from_list',
          type: SettingItemType.String,
          isEnum: true,
          section: 'jarvis.annotate',
          public: true,
          label: '注释: 标签方法',
          description: '用于标记笔记的方法。默认: 根据现有标签建议',
          options: {
              'from_notes': '根据笔记建议',
              'from_list': '根据现有标签建议',
              'unsupervised': '建议新标签',
          }
      },
      'annotate_tags_max': {
          value: 5,
          type: SettingItemType.Int,
          minimum: 1,
          maximum: 100,
          step: 1,
          section: 'jarvis.annotate',
          public: true,
          label: '注释: 最大建议标签数',
          description: '默认: 5',
      },
      'scopus_api_key': {
          value: 'YOUR_SCOPUS_API_KEY',
          type: SettingItemType.String,
          secure: true,
          section: 'jarvis.research',
          public: true,
          label: '研究: Scopus API 密钥',
          description: '您的 Elsevier/Scopus API 密钥（可选，用于研究）。请在 https://dev.elsevier.com/ 获取。',
      },
      'springer_api_key': {
          value: 'YOUR_SPRINGER_API_KEY',
          type: SettingItemType.String,
          secure: true,
          section: 'jarvis.research',
          public: true,
          label: '研究: Springer API 密钥',
          description: '您的 Springer API 密钥（可选，用于研究）。请在 https://dev.springernature.com/ 获取。',
      },
      'paper_search_engine': {
          value: 'Semantic Scholar',
          type: SettingItemType.String,
          isEnum: true,
          section: 'jarvis.research',
          public: true,
          label: '研究: 论文搜索引擎',
          description: '用于研究提示的搜索引擎。默认: Semantic Scholar',
          options: search_engines,
      },
      'use_wikipedia': {
          value: true,
          type: SettingItemType.Bool,
          section: 'jarvis.research',
          public: true,
          label: '研究: 在研究提示中包含维基百科搜索',
          description: '默认: true',
      },
      'include_paper_summary': {
          value: false,
          type: SettingItemType.Bool,
          section: 'jarvis.research',
          public: true,
          label: '研究: 在研究提示响应中包含论文摘要',
          description: '默认: false',
      },
      'chat_prefix': {
          value: '\\n\\n---\\n**Jarvis:** ',
          type: SettingItemType.String,
          section: 'jarvis.chat',
          public: true,
          label: '聊天: Jarvis 前缀',
          description: '默认: "\\n\\n---\\n**Jarvis:** "',
      },
      'chat_suffix': {
          value: '\\n\\n---\n**User:** ',
          type: SettingItemType.String,
          section: 'jarvis.chat',
          public: true,
          label: '聊天: 用户前缀',
          description: '默认: "\\n\\n---\\n**User:** "',
      },
      'instruction': {
          value: '',
          type: SettingItemType.String,
          section: 'jarvis.chat',
          public: true,
          advanced: true,
          label: '提示: 指令下拉选项',
          description: '显示在下拉菜单中的常用指令提示（{label:prompt, ...} JSON）。',
      },
      'scope': {
          value: '',
          type: SettingItemType.String,
          section: 'jarvis.chat',
          public: true,
          advanced: true,
          label: '提示: 范围下拉选项',
          description: '显示在下拉菜单中的常用范围提示（{label:prompt, ...} JSON）。',
      },
      'role': {
          value: '',
          type: SettingItemType.String,
          section: 'jarvis.chat',
          public: true,
          advanced: true,
          label: '提示: 角色下拉选项',
          description: '显示在下拉菜单中的常用角色提示（{label:prompt, ...} JSON）。',
      },
      'reasoning': {
          value: '',
          type: SettingItemType.String,
          section: 'jarvis.chat',
          public: true,
          advanced: true,
          label: '提示: 推理下拉选项',
          description: '显示在下拉菜单中的常用推理提示（{label:prompt, ...} JSON）。',
      },
      'notes_exclude_folders': {
          value: '',
          type: SettingItemType.String,
          section: 'jarvis.notes',
          public: true,
          advanced: true,
          label: '笔记: 从笔记数据库中排除的文件夹',
          description: '以逗号分隔的文件夹 ID 列表。',
      },
      'notes_panel_title': {
          value: '相关笔记',
          type: SettingItemType.String,
          section: 'jarvis.notes',
          public: true,
          advanced: true,
          label: '笔记: 笔记面板标题',
      },
      'notes_panel_user_style': {
          value: '',
          type: SettingItemType.String,
          section: 'jarvis.notes',
          public: true,
          advanced: true,
          label: '笔记: 笔记面板用户 CSS',
          description: '应用于笔记面板的自定义 CSS。',
      }
  });

  // set default values
  // (it seems that default values are ignored for secure settings)
  const secure_fields = ['openai_api_key', 'hf_api_key', 'google_api_key', 'scopus_api_key', 'springer_api_key']
  for (const field of secure_fields) {
    const value = await joplin.settings.value(field);
    if (value.length == 0) {
      await joplin.settings.setValue(field, field);
    }
  }
}

export async function set_folders(exclude: boolean, folder_id: string, settings: JarvisSettings) {
  // 删除空字符串（当设置字段为空时会留下空字符串）
  settings.notes_exclude_folders.delete('');
  // 获取文件夹树结构 (folderId: 子文件夹Ids)
  const T = await get_folder_tree();
  let q = ['root'];
  let folder: string;
  let found = false;

  // 广度优先搜索
  while (q.length) {
    folder = q.shift();
    if (folder_id == folder) {
      // 重启队列并开始累积
      found = true;
      q = [];
    }
    if (T.has(folder))
      q.push(...T.get(folder));

    if (!found)
      continue;

    if (exclude) {
      settings.notes_exclude_folders.add(folder);
    } else {
      settings.notes_exclude_folders.delete(folder);
    }
  }

  // 更新设置中的排除文件夹列表
  await joplin.settings.setValue('notes_exclude_folders',
    Array.from(settings.notes_exclude_folders).toString());
}

async function get_folder_tree(): Promise<Map<string, string[]>> {
  // 创建一个 Map 来存储文件夹树结构 (folderId: 子文件夹Ids)
  let T = new Map() as Map<string, string[]>;
  let pageNum = 1;
  let hasMore = true;

  while (hasMore) {
    const { items, has_more } = await joplin.data.get(
      ['folders'], { page: pageNum++ });
    hasMore = has_more;

    for (const folder of items) {
      if (!folder.id)
        continue;
      if (!folder.parent_id)
        folder.parent_id = 'root';

      if (!T.has(folder.parent_id)) {
        T.set(folder.parent_id, [folder.id]);
      } else {
        T.get(folder.parent_id).push(folder.id);
      }
    }
  }
  return T;
}

