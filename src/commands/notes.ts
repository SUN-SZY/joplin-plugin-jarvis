import joplin from 'api';
import { find_nearest_notes, update_embeddings } from '../notes/embeddings';
import { update_panel, update_progress_bar } from '../ux/panel';
import { get_settings } from '../ux/settings';
import { TextEmbeddingModel } from '../models/models';

export async function update_note_db(model: TextEmbeddingModel, panel: string): Promise<void> {
  if (model.model === null) { return; }

  const settings = await get_settings();

  let notes: any;
  let page = 0;
  let total_notes = 0;
  let processed_notes = 0;

  // 统计所有笔记
  do {
    page += 1;
    notes = await joplin.data.get(['notes'], { fields: ['id'], page: page });
    total_notes += notes.items.length;
  } while (notes.has_more);
  update_progress_bar(panel, 0, total_notes, settings);

  page = 0;
  // 遍历所有笔记
  do {
    page += 1;
    notes = await joplin.data.get(['notes'], { fields: ['id', 'title', 'body', 'is_conflict', 'parent_id', 'deleted_time', 'markup_language'], page: page, limit: model.page_size });
    if (notes.items) {
      console.log(`处理第 ${page} 页: ${notes.items.length} 篇笔记`);
      await update_embeddings(notes.items, model, settings);
      processed_notes += notes.items.length;
      update_progress_bar(panel, processed_notes, total_notes, settings);
    }
    // 速率限制
    if (notes.has_more && (page % model.page_cycle) == 0) {
      console.log(`等待 ${model.wait_period} 秒...`);
      await new Promise(res => setTimeout(res, model.wait_period * 1000));
    }
  } while (notes.has_more);

  find_notes(model, panel);
}

export async function find_notes(model: TextEmbeddingModel, panel: string) {
  if (!(await joplin.views.panels.visible(panel))) {
    return;
  }
  if (model.model === null) { return; }
  const settings = await get_settings();

  const note = await joplin.workspace.selectedNote();
  if (!note) {
    return;
  }
  if (note.markup_language === 2) {
    return;
  }
  let selected = await joplin.commands.execute('selectedText');
  if (!selected || (selected.length === 0)) {
    selected = note.body;
  }
  const nearest = await find_nearest_notes(model.embeddings, note.id, note.title, selected, model, settings);

  // 将结果写入面板
  await update_panel(panel, nearest, settings);
}

export async function skip_db_init_dialog(model: TextEmbeddingModel): Promise<boolean> {
  if (model.embeddings.length > 0) { return false; }

  let calc_msg = `此数据库通过运行 ${model.id} 在本地（离线）计算。`;
  let compute = 'PC';
  if (model.online) {
    calc_msg = `此数据库通过向 ${model.id} 发送请求在远程（在线）计算。`;
    compute = '连接';
  }
  return (await joplin.views.dialogs.showMessageBox(
    `你好！Jarvis 可以为你的笔记构建一个数据库，该数据库可用于搜索相似笔记或与笔记聊天。
    
    ${calc_msg}，然后存储在本地 sqlite 数据库中。
    
    *如果* 你选择与笔记聊天，数据库中的短摘将被发送到你选择的在线/离线模型。
    
    你可以随时通过删除文件来删除该数据库。初始化可能需要几分钟到几小时不等（快速 ${compute}，约 500 篇笔记收集）。
    
    点击“确定”现在在后台运行，或点击“取消”稍后进行（例如，夜间）。你可以在“工具”-->“Jarvis”-->“更新 Jarvis 笔记数据库”中随时启动该过程。你可以通过将“数据库更新周期”设置为 0 来无限期延迟。`
    ) == 1);
}
