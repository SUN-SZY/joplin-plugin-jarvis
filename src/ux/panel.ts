import joplin from 'api';
import { NoteEmbedding } from '../notes/embeddings';
import { JarvisSettings } from './settings';

export async function register_panel(panel: string, settings: JarvisSettings, model: any) {
  let model_str = '';
  if (model.model === null) {
    model_str = '模型加载失败。'
    if (!model.online) {
      model_str += `请注意，${model.id} 完全本地运行，但需要网络访问才能加载模型。`;
    }
  }
  await joplin.views.panels.addScript(panel, 'ux/webview.css');
  await joplin.views.panels.addScript(panel, 'ux/webview.js');
  await joplin.views.panels.setHtml(panel, `<div class="container"><p class="jarvis-semantic-title">${settings.notes_panel_title}</p><p>${model_str}</p></div>`);
}

export async function update_panel(panel: string, nearest: NoteEmbedding[], settings: JarvisSettings) {
  // TODO: 根据设置折叠
  let search_box = '<p align="center"><input class="jarvis-semantic-query" type="search" id="jarvis-search" placeholder="语义搜索..."></p>';
  if (!settings.notes_search_box) { search_box = ''; }

  await joplin.views.panels.setHtml(panel, `
  <html>
  <style>
  ${settings.notes_panel_user_style}
  </style>
  <div class="container">
    <p class="jarvis-semantic-title">${settings.notes_panel_title}</p>
    ${search_box}
    ${(await Promise.all(nearest)).map((n) => `
    <details ${n.title === "Chat context" ? "open" : ""}>
      <summary class="jarvis-semantic-note">
      <a class="jarvis-semantic-note" href="#" data-note="${n.id}" data-line="0">${n.title}</a></summary>
      <div class="jarvis-semantic-section" >
      ${n.embeddings.map((embd) => `
        <a class="jarvis-semantic-section" href="#" data-note="${embd.id}" data-line="${embd.line}">
        (${(100 * embd.similarity).toFixed(0)}) 行${String(embd.line).padStart(4, '0')}: ${embd.title}
        </a><br>
      `).join('')}
      </div>
    </details>
  </div>
  `).join('')}
`);
}

export async function update_progress_bar(panel: string, processed: number, total: number, settings: JarvisSettings) {
  await joplin.views.panels.setHtml(panel, `
  <html>
  <div class="container">
    <p class="jarvis-semantic-title">${settings.notes_panel_title}</p>
    <p class="jarvis-semantic-note">正在更新笔记数据库...</p>
    <progress class="jarvis-semantic-progress" value="${processed}" max="${total}"></progress>
    <p class="jarvis-semantic-note">已处理的笔记总数: ${processed} / ${total}</p>
  </div>
  `);
}
