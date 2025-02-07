import joplin from "api";
import { JarvisSettings, search_prompts } from '../ux/settings';
import { TextGenerationModel } from "../models/models";
import { split_by_tokens, with_timeout } from "../utils";

export interface PaperInfo {
  title: string;
  author: string;
  year: number;
  journal: string;
  doi: string;
  citation_count: number;
  text: string;
  summary: string;
  compression: number;
}

export interface SearchParams {
  prompt: string;
  response: string;
  queries: string[];
  questions: string;
}

export async function search_papers(model_gen: TextGenerationModel,
    prompt: string, n: number, settings: JarvisSettings,
    min_results: number = 10, retries: number = 2): Promise<[PaperInfo[], SearchParams]> {

  const search = await get_search_queries(model_gen, prompt, settings);

  // 并行运行多个查询并去除重复项
  let results: PaperInfo[] = [];
  let dois: Set<string> = new Set();
  (await Promise.all(
    search.queries.map((query) => {
      if (settings.paper_search_engine == 'Scopus') {
        return run_scopus_query(query, n, settings);
      } else if (settings.paper_search_engine == 'Semantic Scholar') {
        return run_semantic_scholar_query(query, n);
      }
    })
  )).forEach((query) => {
    if (!query) { return; }
    query.forEach((paper) => {
      if (!dois.has(paper.doi)) {
        results.push(paper);
        dois.add(paper.doi);
      }
    });
  });

  if ((results.length < min_results) && (retries > 0)) {
    console.log(`搜索 ${retries - 1}`);
    return search_papers(model_gen, prompt, n, settings, min_results, retries - 1);
  }
  return [results, search];
}

async function run_semantic_scholar_query(query: string, papers: number): Promise<PaperInfo[]> {
  const options = {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  };

  // 计算获取 n 个结果所需的页数
  let limit = Math.min(papers, 100);
  let pages = Math.ceil(papers / limit);

  let start = 0;
  let results: PaperInfo[] = [];

  for (let p = 0; p < pages; p++) {
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${query}&limit=${limit}&page=${start}&fields=abstract,authors,title,year,venue,citationCount,externalIds`;
    let response = await fetch(url, options);

    let jsonResponse: any;
    let papers: any[] = [];
    if (response.ok) {
      jsonResponse = await response.json();
      papers = jsonResponse['data'];
    }

    if (!response.ok) {
      start += 25;
      continue;
    }

    try {
      for (let i = 0; i < papers.length; i++) {
        let journal: string = papers[i]['venue'];
        if (!journal) {
          if (papers[i]['journal']) {
            journal = papers[i]['journal']['name'];
          } else { journal = '未知'; }
        }
        let author = '未知';
        if (papers[i]['authors'][0]) {
          author = papers[i]['authors'][0]['name'].split(' ').slice(1).join(' ');  // 姓氏
        }

        const info: PaperInfo = {
          title: papers[i]['title'],
          author: author,
          year: parseInt(papers[i]['year'], 10),
          journal: journal,
          doi: papers[i]['externalIds']['DOI'],
          citation_count: papers[i]['citationCount'],
          text: papers[i]['abstract'],
          summary: '',
          compression: 1,
        };
        results.push(info);
      }
    } catch (error) {
      console.log(error);
    }
  }

  return results.slice(0, papers);
}

async function run_scopus_query(query: string, papers: number, settings: JarvisSettings): Promise<PaperInfo[]> {
  const headers = {
    'Accept': 'application/json',
    'X-ELS-APIKey': settings.scopus_api_key,
  };
  const options = {
    method: 'GET',
    headers: headers,
  };

  // 计算获取 n 个结果所需的页数
  let pages = Math.ceil(papers / 25);

  let start = 0;
  let results: PaperInfo[] = [];

  for (let p = 0; p < pages; p++) {
    const url = `https://api.elsevier.com/content/search/scopus?query=${query}&count=25&start=${start}&sort=-relevancy,-citedby-count,-pubyear`;
    let response = await fetch(url, options);

    let jsonResponse: any;
    let papers: any[] = [];
    if (response.ok) {
      jsonResponse = await response.json();
      papers = jsonResponse['search-results']['entry'];
    }

    if (!response.ok || !papers || papers[0].hasOwnProperty('error')) {
      start += 25;
      continue;
    }

    try {
      for (let i = 0; i < papers.length; i++) {
        try {
          const info: PaperInfo = {
            title: papers[i]['dc:title'],
            author: papers[i]['dc:creator'].split(', ')[0].split(' ')[0],
            year: parseInt(papers[i]['prism:coverDate'].split('-')[0], 10),
            journal: papers[i]['prism:publicationName'],
            doi: papers[i]['prism:doi'],
            citation_count: parseInt(papers[i]['citedby-count'], 10),
            text: papers[i]['dc:description'],
            summary: '',
            compression: 1,
          };
          results.push(info);
        } catch {
          console.log('跳过', papers[i]);

        }
      }

      start += 25;
      if (jsonResponse['search-results']['opensearch:totalResults'] < start) {
        break;
      }

    } catch (error) {
      console.log(error);
    }
  }

  return results.slice(0, papers);
}

async function get_search_queries(model_gen: TextGenerationModel, prompt: string, settings: JarvisSettings): Promise<SearchParams> {
  const response = await model_gen.complete(
    `你正在撰写一篇学术论文。
    首先，列出从以下提示中产生的几个研究问题。
    ${search_prompts[settings.paper_search_engine]}
    提示:\n${prompt}
    使用以下格式进行响应。
    # [论文标题]

    ## 研究问题

    1. [主要问题]
    2. [次要问题]
    3. [附加问题]

    ## 查询

    1. [搜索查询]
    2. [搜索查询]
    3. [搜索查询]
    `);

  const query = response.split(/# 研究问题|# 查询/gi);

  return {
    prompt: prompt,
    response: response.trim().replace(/## 研究问题/gi, '## 提示\n\n' + prompt + '\n\n## 研究问题') + '\n\n## 参考文献\n\n',
    queries: query[2].trim().split('\n').map((q) => { return q.substring(q.indexOf(' ') + 1); }),
    questions: query[1].trim()
  };
}

export async function sample_and_summarize_papers(model_gen: TextGenerationModel,
    papers: PaperInfo[], max_tokens: number,
    search: SearchParams, settings: JarvisSettings): Promise<PaperInfo[]> {
  let results: PaperInfo[] = [];
  let tokens = 0;

  // 随机化论文顺序
  papers.sort(() => Math.random() - 0.5);
  const promises: Promise<PaperInfo>[] = [];
  for (let i = 0; i < papers.length; i++) {

    if (promises.length <= i) {
      // 异步获取接下来 5 篇论文的摘要
      for (let j = 0; j < 5; j++) {
        if (i + j < papers.length) {
          promises.push(get_paper_summary(model_gen, papers[i + j], search.questions, settings));
        }
      }
    }
    // 等待下一个摘要准备好
    papers[i] = await promises[i];
    if (papers[i]['summary'].length == 0) { continue; }

    // 我们只总结总长度不超过 max_tokens 的论文
    const this_tokens = model_gen.count_tokens(papers[i]['summary']);
    if (tokens + this_tokens > max_tokens) {
      break;
    }
    results.push(papers[i]);
    tokens += this_tokens;
  }

  console.log(`采样了 ${results.length} 篇论文。获取了 ${promises.length} 篇论文。`);
  return results;
}

async function get_paper_summary(model_gen: TextGenerationModel, paper: PaperInfo,
    questions: string, settings: JarvisSettings): Promise<PaperInfo> {
  paper = await get_paper_text(paper, model_gen, settings);
  if (!paper['text']) { return paper; }

  const user_temp = model_gen.temperature;
  model_gen.temperature = 0.3;
  const prompt = `你是一个乐于助人的助手，正在进行文献综述。
    如果以下研究包含与研究问题相关的信息，
    请以单段形式返回研究的相关部分摘要。
    仅当研究完全不相关时，即使广泛而言，也返回：'不相关' 并解释为什么它没有帮助。
    研究问题:\n${questions}
    研究:\n${paper['text']}`;
  const response = await model_gen.complete(prompt);
  // 考虑研究的目标、假设、方法/程序、结果/结果、局限性和影响。
  model_gen.temperature = user_temp;

  if (response.includes('不相关') || (response.trim().length == 0)) {
    paper['summary'] = '';
    return paper;
  }

  paper['summary'] = `(${paper['author']}, ${paper['year']}) ${response.replace(/\n+/g, ' ')}`;
  paper['compression'] = paper['summary'].length / paper['text'].length;

  let cite = `- ${paper['author']} 等., [${paper['title']}](https://doi.org/${paper['doi']}), ${paper['journal']}, ${paper['year']}, 引用次数: ${paper['citation_count']}.\n`;
  if (settings.include_paper_summary) {
    cite += `\t- ${paper['summary']}\n`;
  }
  await joplin.commands.execute('replaceSelection', cite);
  return paper;
}

async function get_paper_text(paper: PaperInfo, model_gen: TextGenerationModel, settings: JarvisSettings): Promise<PaperInfo> {
  if (paper['text']) { return paper; }  // 已经有文本
  let info = await get_scidir_info(paper, model_gen, settings);  // ScienceDirect (Elsevier)，全文或摘要
  if (info['text']) { return info; }
  else {
    info = await get_semantic_scholar_info(paper, settings);  // Semantic Scholar，摘要
    if (info['text']) { return info; }
    else {
      info = await get_crossref_info(paper);  // Crossref，摘要
      if (info['text']) { return info; }
      else {
        info = await get_springer_info(paper, settings);  // Springer，摘要
        if (info['text']) { return info; }
        else {
          return await get_scopus_info(paper, settings);  // Scopus，摘要
        }
      }
    }
  }
}

async function get_crossref_info(paper: PaperInfo): Promise<PaperInfo> {
  const url = `https://api.crossref.org/works/${paper['doi']}`;
  const headers = {
    "Accept": "application/json",
  };
  const options = {
    method: 'GET',
    headers: headers,
  };
  let response: any;
  try {
    response = await with_timeout(5000, fetch(url, options));
  } catch {
    console.log('超时 crossref');
    return paper;
  }

  if (!response.ok) { return paper; }

  let jsonResponse: any;
  try {
    jsonResponse = await response.json();
    const info = jsonResponse['message'];
    if (info.hasOwnProperty('abstract') && (typeof info['abstract'] === 'string')) {
      paper['text'] = info['abstract'].trim();
    }
  }
  catch (error) {
    console.log(error);
    console.log(jsonResponse);
  }
  return paper;
}

async function get_scidir_info(paper: PaperInfo,
      model_gen: TextGenerationModel, settings: JarvisSettings): Promise<PaperInfo> {
  if (!settings.scopus_api_key) { return paper; }

  const url = `https://api.elsevier.com/content/article/doi/${paper['doi']}`;
  const headers = {
    'Accept': 'application/json',
    'X-ELS-APIKey': settings.scopus_api_key,
  };
  const options = {
    method: 'GET',
    headers: headers,
  };
  let response: any;
  try {
    response = await with_timeout(5000, fetch(url, options));
  } catch {
    console.log('超时 scidir');
    return paper;
  }

  if (!response.ok) { return paper; }

  let jsonResponse: any;
  try {
    jsonResponse = await response.json();
    const info = jsonResponse['full-text-retrieval-response'];
    if ((info['originalText']) && (typeof info['originalText'] === 'string')) {

      try {
        const regex = new RegExp(/讨论|结论/gmi);
        if (regex.test(info['originalText'])) {
          // 获取正文结束部分
          paper['text'] = info['originalText']
            .split(/\b参考文献/gmi).slice(-2)[0]
            .split(/致谢|感谢/gmi).slice(-2)[0]
            .split(regex).slice(-1)[0];

        } else {
          // 获取正文开始部分
          paper['text'] = info['originalText'].split(/http/gmi)[-1];  // 移除前面的 URL
        }
        paper['text'] = split_by_tokens(
          paper['text'].trim().split('\n'),
          model_gen, 0.75 * model_gen.max_tokens)[0].join('\n');
      } catch {
        paper['text'] = '';
      }
    }
    if (!paper['text'] && info['coredata']['dc:description']) {
      paper['text'] = info['coredata']['dc:description'].trim();
    }
  }
  catch (error) {
    console.log(error);
    console.log(jsonResponse);
  }
  return paper;
}

async function get_scopus_info(paper: PaperInfo, settings: JarvisSettings): Promise<PaperInfo> {
  if (!settings.scopus_api_key) { return paper; }

  const url = `https://api.elsevier.com/content/abstract/doi/${paper['doi']}`;
  const headers = {
    'Accept': 'application/json',
    'X-ELS-APIKey': settings.scopus_api_key,
  };
  const options = {
    method: 'GET',
    headers: headers,
  };
  let response: any;
  try {
    response = await with_timeout(5000, fetch(url, options));
  } catch {
    console.log('超时 scopus');
    return paper;
  }

  if (!response.ok) { return paper; }

  let jsonResponse: any;
  try {
    jsonResponse = await response.json();
    const info = jsonResponse['abstracts-retrieval-response']['coredata'];
    if (info['dc:description']) {
      paper['text'] = info['dc:description'].trim();
    }
  }
  catch (error) {
    console.log(error);
    console.log(jsonResponse);
  }
  return paper;
}

async function get_springer_info(paper: PaperInfo, settings: JarvisSettings): Promise<PaperInfo> {
  if (!settings.springer_api_key) { return paper; }

  const url = `https://api.springernature.com/metadata/json/doi/${paper['doi']}?api_key=${settings.springer_api_key}`;
  const headers = {
    'Accept': 'application/json',
  };
  const options = {
    method: 'GET',
    headers: headers,
  };
  let response: any;
  try {
    response = await with_timeout(5000, fetch(url, options));
  } catch {
    console.log('超时 springer');
    return paper;
  }

  if (!response.ok) { return paper; }

  let jsonResponse: any;
  try {
    jsonResponse = await response.json();
    if (jsonResponse['records'].length == 0) { return paper; }
    const info = jsonResponse['records'][0]['abstract'];
    if (info) {
      paper['text'] = info.trim();
    }
  }
  catch (error) {
    console.log(error);
    console.log(jsonResponse);
  }
  return paper;
}

async function get_semantic_scholar_info(paper: PaperInfo, settings: JarvisSettings): Promise<PaperInfo> {
  const url = `https://api.semanticscholar.org/v1/paper/DOI:${paper['doi']}?fields=abstract`;
  const headers = {
    'Accept': 'application/json',
  };
  const options = {
    method: 'GET',
    headers: headers,
  };
  let response: any;
  try {
    response = await with_timeout(5000, fetch(url, options));
  } catch {
    console.log('超时 semantic_scholar');
    return paper;
  }

  if (!response.ok) { return paper; }

  let jsonResponse: any;
  try {
    jsonResponse = await response.json();
    const info = jsonResponse['abstract'];
    if (info) {
      paper['text'] = info.trim();
    }
  }
  catch (error) {
    console.log(error);
    console.log(jsonResponse);
  }
  return paper;
}
