import joplin from 'api';
import { get_chat_prompt, replace_selection } from './chat';
import { TextGenerationModel } from '../models/models';

export async function auto_complete(model_gen: TextGenerationModel) {
  const note = await joplin.workspace.selectedNote();
  const context = `笔记内容\n===\n# ${note.title}\n\n${(await get_chat_prompt(model_gen))}\n`;
  const placeholder = `笔记续写\n===\n`;
  const prompt = `使用单个句子到最多一个段落的内容继续以下笔记。*仅*返回完成给定文本的字符，不包含任何特殊字符、分隔符、定界符或引号。\n\n${context}\n\n${placeholder}`;

  replace_selection('\n\n生成自动补全中....');
  const response = await model_gen.complete(prompt);
  replace_selection('\n' + response);
}
