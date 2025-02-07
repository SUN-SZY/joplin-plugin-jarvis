import joplin from 'api';
import { DialogResult } from 'api/types';
import { TextGenerationModel } from '../models/models';
import { PaperInfo, SearchParams, search_papers, sample_and_summarize_papers } from '../research/papers';
import { WikiInfo, search_wikipedia } from '../research/wikipedia';
import { JarvisSettings, get_settings, parse_dropdown_json, search_engines } from '../ux/settings';

export async function research_with_jarvis(model_gen: TextGenerationModel, dialogHandle: string) {
  const settings = await get_settings();

  const result = await get_research_params(dialogHandle, settings);

  if (!result) { return; }
  if (result.id === "cancel") { return; }

  // 研究参数
  const prompt = result.formData.ask.prompt;
  const n_papers = parseInt(result.formData.ask.n_papers);

  settings.paper_search_engine = result.formData.ask.search_engine;
  if ((settings.paper_search_engine === 'Scopus') && (settings.scopus_api_key === '')) {
    joplin.views.dialogs.showMessageBox('请在设置中设置您的 Scopus API 密钥。');
    return;
  }
  const use_wikipedia = result.formData.ask.use_wikipedia;

  const only_search = result.formData.ask.only_search;
  let paper_tokens = Math.ceil(parseInt(result.formData.ask.paper_tokens) / 100 * model_gen.max_tokens);
  if (only_search) {
    paper_tokens = Infinity;  // 不限制总结的论文数量
    settings.include_paper_summary = true;
  }

  await do_research(model_gen, prompt, n_papers, paper_tokens, use_wikipedia, only_search, settings);
}

async function get_research_params(
  dialogHandle: string, settings: JarvisSettings): Promise<DialogResult> {
  let defaultPrompt = await joplin.commands.execute('selectedText');
  const user_wikipedia = settings.use_wikipedia ? 'checked' : '';

  await joplin.views.dialogs.setHtml(dialogHandle, `
    <form name="ask">
      <h3>使用 Jarvis 进行研究</h3>
      <div>
        <textarea id="research_prompt" name="prompt">${defaultPrompt}</textarea>
      </div>
      <div>
        <label for="n_papers">论文空间</label>
        <input type="range" title="搜索前 500 篇论文并从中采样" name="n_papers" id="n_papers" size="25" min="0" max="500" value="50" step="10"
        oninput="title='搜索前 ' + value + ' 篇论文并从中采样'" />
      </div>
      <div>
        <label for="paper_tokens">论文标记</label>
        <input type="range" title="包含在提示中的论文上下文（最大标记的 50%）" name="paper_tokens" id="paper_tokens" size="25" min="10" max="90" value="50" step="10"
        oninput="title='论文上下文 (' + value + '% of 最大标记) 包含在提示中'" />
      </div>
      <div>
        <label for="search_engine">
          搜索引擎: 
          <select title="搜索引擎" name="search_engine" id="search_engine">
            ${parse_dropdown_json(search_engines, settings.paper_search_engine)}
          </select>
          <input type="checkbox" title="使用维基百科" id="use_wikipedia" name="use_wikipedia" ${user_wikipedia} />
          维基百科
        </label>
        <label for="only_search">
          <input type="checkbox" title="仅显示提示" id="only_search" name="only_search" />
          仅执行搜索，不生成综述，并忽略论文标记
        </label>
      </div>
    </form>
    `);

  await joplin.views.dialogs.addScript(dialogHandle, 'ux/view.css');
  await joplin.views.dialogs.setButtons(dialogHandle,
    [{ id: "submit", title: "提交"},
    { id: "cancel", title: "取消"}]);
  await joplin.views.dialogs.setFitToContent(dialogHandle, true);

  const result = await joplin.views.dialogs.open(dialogHandle);

  if (result.id === "cancel") { return undefined; }

  return result;
}

export async function do_research(model_gen: TextGenerationModel, prompt: string, n_papers: number,
    paper_tokens: number, use_wikipedia: boolean, only_search: boolean, settings: JarvisSettings) {

  let [papers, search] = await search_papers(model_gen, prompt, n_papers, settings);

  await joplin.commands.execute('replaceSelection', search.response);
  let wiki_search: Promise<WikiInfo> = Promise.resolve({ summary: '' });
  if (use_wikipedia && (papers.length > 0)) {
    // 并行启动维基百科搜索
    wiki_search = search_wikipedia(model_gen, prompt, search, settings);
  }
  papers = await sample_and_summarize_papers(model_gen, papers, paper_tokens, search, settings);

  if (papers.length == 0) {
    await joplin.commands.execute('replaceSelection',
      '未找到相关论文。请考虑扩展论文空间、重新发送提示或进行调整。\n')
    return;
  }
  if (only_search) { return; }

  const full_prompt = build_prompt(papers, await wiki_search, search);
  const research = await model_gen.complete(full_prompt);
  await joplin.commands.execute('replaceSelection', '\n## 综述\n\n' + research.trim());
}

function build_prompt(papers: PaperInfo[], wiki: WikiInfo, search: SearchParams): string {
  let full_prompt =
    `根据提示编写响应。回答研究问题。
    使用以下列出的所有相关论文，并在响应中引用所使用的内容。
    请勿引用提供的论文之外的内容，但可以添加被视为常识的额外信息。
    尽量解释缩写和领域特定术语的定义。
    最后，在响应中添加一个 "## 后续问题" 部分。\n\n`;
  full_prompt += wiki['summary'] + '\n\n';
  for (let i = 0; i < papers.length; i++) {
    full_prompt += papers[i]['summary'] + '\n\n';
  }
  full_prompt += `## 提示\n\n${search.prompt}\n`;
  full_prompt += `## 研究问题\n\n${search.questions}\n`;
  return full_prompt;
}
