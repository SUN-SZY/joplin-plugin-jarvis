import joplin from 'api';
import { JarvisSettings } from '../ux/settings';
import { SearchParams } from './papers';
import { TextGenerationModel } from '../models/models';
import { split_by_tokens } from '../utils';

export interface WikiInfo {
  [key: string]: any;
  title?: string;
  year?: number;
  id?: number;
  excerpt?: string;
  text?: string;
  summary: string;
}

// 返回最相关的维基百科页面摘要
export async function search_wikipedia(model_gen: TextGenerationModel,
    prompt: string, search: SearchParams, settings: JarvisSettings): Promise<WikiInfo> {
  const search_term = await get_wikipedia_search_query(model_gen, prompt);
  if ( !search_term ) { return { summary: '' }; }

  const url = `https://zh.wikipedia.org/w/api.php?action=query&list=search&origin=*&format=json&srlimit=20&srsearch=${search_term}`;
  const options = {
    method: 'GET',
    headers: {'Accept': 'application/json'},
  };
  let response = await fetch(url, options);

  if (!response.ok) { return { summary: '' }; }

  let pages: Promise<WikiInfo>[] = [];
  const jsonResponse: any = await response.json();
  const results = jsonResponse['query']['search'];
  for (let i = 0; i < results.length; i++) {
    if (!results[i]['pageid']) { continue; }
    let page: WikiInfo = {
      title: results[i]['title'],
      year: parseInt(results[i]['timestamp'].split('-')[0]),
      id: results[i]['pageid'],
      excerpt: '',
      text: '',
      summary: '',
    };
    pages.push(get_wikipedia_page(page, 'excerpt', 'exintro'));
  }

  let best_page = await get_best_page(model_gen, pages, results.length, search);
  best_page = await get_wikipedia_page(best_page, 'text', 'explaintext');
  best_page = await get_page_summary(model_gen, best_page, search.questions, settings);
  return best_page;
}

async function get_wikipedia_search_query(model_gen: TextGenerationModel, prompt: string): Promise<string> {
  const response = await model_gen.complete(
    `确定提示的主要主题。
    提示:\n${prompt}
    使用以下格式。
    主题: [主要主题]`);

  try {
    return response.split(/主题:/gi)[1].replace(/"/g, '').trim();
  } catch {
    console.log(`无效的维基百科搜索查询:\n${response}`);
    return '';
  }
}

// 获取维基百科页面的完整文本（或其他摘录）
async function get_wikipedia_page(page: WikiInfo, field: string = 'text', section: string = 'explaintext'): Promise<WikiInfo> {
  if (!page['id']) { return page; }
  const url = `https://zh.wikipedia.org/w/api.php?action=query&prop=extracts&${section}&format=json&pageids=${page['id']}`;
  const options = {
    method: 'GET',
    headers: {'Accept': 'application/json'},
  };
  let response = await fetch(url, options);

  if (!response.ok) { return page; }

  const jsonResponse = await response.json();
  const info = jsonResponse['query']['pages'][page['id'] as number];
  page[field] = info['extract'].replace(/<[^>]*>/g, '').trim();  // 移除HTML标签

  return page;
}

async function get_best_page(model_gen: TextGenerationModel,
    pages: Promise<WikiInfo>[], n: number, search: SearchParams): Promise<WikiInfo> {
  // TODO: 我们可以通过每次比较两个页面并保留最佳页面来实现这一点，但这会增加查询次数
  let prompt = `你是一个乐于助人的助手，正在进行文献综述。
    我们正在寻找与研究问题中最相关的单个维基百科页面。
    只返回最相关页面的索引，格式为：[索引号]。
    研究问题:\n${search.questions}\n
    页面列表:\n`;
  let token_sum = model_gen.count_tokens(prompt);
  for (let i = 0; i < n; i++) {
    const page = await pages[i];
    if (!page['excerpt']) { continue; }

    const this_tokens = model_gen.count_tokens(page['excerpt']);
    if (token_sum + this_tokens > 0.9 * model_gen.max_tokens) {
      console.log(`由于 max_tokens 达到限制，停止在第 ${i + 1} 个页面`);
      break;
    }
    token_sum += this_tokens;
    prompt += `${i}. ${page['title']}: ${page['excerpt']}\n\n`;
  }
  const response = await model_gen.complete(prompt);
  const index = response.match(/\d+/);
  if (index) {
    return await pages[parseInt(index[0])];
  } else {
    return { summary: '' };
  }
}

async function get_page_summary(model_gen: TextGenerationModel,
    page: WikiInfo, questions: string, settings: JarvisSettings): Promise<WikiInfo> {
  if ((!page['text']) || (page['text'].length == 0)) { return page; }

  const user_p = model_gen.top_p;
  model_gen.top_p = 0.2;  // 使模型更加聚焦

  const prompt =
    `这里是一篇文章的部分内容、研究问题和文章整体的摘要草稿。
    如果该部分与回答这些问题无关，请在响应中返回原始摘要而不做更改。
    否则，请添加与问题相关的信息到摘要中，并在响应中输出修订后的摘要。
    在响应中，不要删除摘要中已存在的相关信息，
    并描述整篇文章如何回答给定的问题。`;

  let summary = '空摘要。';
  const summary_steps = split_by_tokens(
    page['text'].split('\n'), model_gen, 0.75 * model_gen.max_tokens);
  for (let i = 0; i < summary_steps.length; i++) {
    const text = summary_steps[i].join('\n');
    summary = await model_gen.complete(
      `${prompt}
       段落: ${text}
       研究问题: ${questions}
       摘要: ${summary}
       响应:`);
  }
  const decision = await model_gen.complete(
    `判断以下摘要是否与任何研究问题相关。
    如果它与任何问题都无关，请返回 "不相关" 并解释原因。
    摘要:\n${summary}
    研究问题:\n${questions}`);

  model_gen.top_p = user_p;

  if ((decision.includes('不相关')) || (summary.trim().length == 0)) {
    return page;
  }

  page['summary'] = `(维基百科, ${page['year']}) ${summary.replace(/\n+/g, ' ')}`;

  const wikilink = page['title'] ? page['title'].replace(/ /g, '_') : '';
  let cite = `- 维基百科, [${page['title']}](https://zh.wikipedia.org/wiki/${wikilink}), ${page['year']}.\n`;
  if (settings.include_paper_summary) {
    cite += `\t- ${page['summary']}\n`;
  }
  await joplin.commands.execute('replaceSelection', cite);

  return page;
}
