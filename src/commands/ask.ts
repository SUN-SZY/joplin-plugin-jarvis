import joplin from 'api';
import { DialogResult } from 'api/types';
import { TextGenerationModel } from '../models/models';
import { JarvisSettings, get_settings } from '../ux/settings';

export async function ask_jarvis(model_gen: TextGenerationModel, dialogHandle: string) {
  const settings = await get_settings();
  const result = await get_completion_params(dialogHandle, settings);

  if (!result) { return; }
  if (result.id === "cancel") { return; }

  const prompt = build_prompt(result.formData.ask);
  let completion = await model_gen.complete(prompt);

  if (result.formData.ask.include_prompt) {
    completion = prompt + completion;
  }
  completion += '\n';

  await joplin.commands.execute('replaceSelection', completion);
}

export async function get_completion_params(
  dialogHandle: string, settings: JarvisSettings): Promise<DialogResult> {
  let defaultPrompt = await joplin.commands.execute('selectedText');
  const include_prompt = settings.include_prompt ? 'checked' : '';

  await joplin.views.dialogs.setHtml(dialogHandle, `
    <form name="ask">
      <h3>向 Jarvis 提问</h3>
      <div>
        <select title="指令" name="instruction" id="instruction">
          ${settings.instruction}
        </select>
        <select title="范围" name="scope" id="scope">
          ${settings.scope}
        </select>
        <select title="角色" name="role" id="role">
          ${settings.role}
        </select>
        <select title="推理" name="reasoning" id="reasoning">
          ${settings.reasoning}
        </select>
      </div>
      <div>
        <textarea name="prompt">${defaultPrompt}</textarea>
      </div>
      <div>
        <label for="include_prompt">
        <input type="checkbox" title="显示提示" id="include_prompt" name="include_prompt" ${include_prompt} />
        在响应中显示提示
        </label>
      </div>
    </form>
    `);

  await joplin.views.dialogs.addScript(dialogHandle, 'ux/view.css');
  await joplin.views.dialogs.setButtons(dialogHandle,
    [{ id: "submit", title: "提交" },
    { id: "cancel", title: "取消" }]);
  await joplin.views.dialogs.setFitToContent(dialogHandle, true);

  const result = await joplin.views.dialogs.open(dialogHandle);

  if (result.id === "cancel") { return undefined; }

  return result;
}

export async function edit_with_jarvis(model_gen: TextGenerationModel, dialogHandle: string) {
  let selection = await joplin.commands.execute('selectedText');
  if (!selection) { return; }

  const settings = await get_settings();
  const result = await edit_action(model_gen, dialogHandle, selection, settings);

  if (!result) { return; }
  if (result.id === "cancel") { return; }
}

async function edit_action(model_gen: TextGenerationModel, dialogHandle: string, input: string, settings: any): Promise<DialogResult> {
  let result: DialogResult;
  let buttons = [
    { id: "submit", title: "提交" },
    { id: "replace", title: "替换" },
    { id: "cancel", title: "取消" }
  ];
  let resultValue: string = input;
  let resultLabel: string = '选中的文本';
  // 添加迭代变量以便监控循环
  let iteration = 0;
  do {
    // 仅在迭代为 0 时执行此循环
    if (iteration === 0) {
      await joplin.views.dialogs.setHtml(dialogHandle, `
        <form name="ask">
          <h3>使用 Jarvis 编辑</h3>
          <div id="resultTextbox">
            <label for="result">${resultLabel}</label><br>
            <textarea id="taresult" name="result">${resultValue}</textarea>
          </div>
          <div id="promptTextbox">
            <label for="prompt">提示</label><br>
            <textarea id="taprompt" name="prompt" placeholder="你希望 Jarvis 如何编辑？"></textarea>
          </div>
        </form>
      `);
      await joplin.views.dialogs.addScript(dialogHandle, 'ux/view.css');
      await joplin.views.dialogs.setButtons(dialogHandle, buttons);
      await joplin.views.dialogs.setFitToContent(dialogHandle, true);
    }

    result = await joplin.views.dialogs.open(dialogHandle);

    if (result.id === "submit" || result.id === "resubmit" || result.id === "clear") {
      // 将结果框中的文本替换为原始选择
      if (result.id === "clear") {
        resultValue = input;
        resultLabel = '选中的文本';
      } else {
        resultValue = await query_edit(model_gen, result.formData.ask.result, result.formData.ask.prompt);
        resultLabel = '编辑后的文本';
      };
      // 重新创建对话框
      await joplin.views.dialogs.setHtml(dialogHandle, `
        <form name="ask">
          <h3>使用 Jarvis 编辑</h3>
          <div id="resultTextbox">
            <label for="result">${resultLabel}</label><br>
            <textarea id="taresult" name="result">${resultValue}</textarea>
          </div>
          <div id="promptTextbox">
            <label for="prompt">提示</label><br>
            <textarea id="taprompt" name="prompt" placeholder="你希望 Jarvis 如何编辑？">${result.formData.ask.prompt}</textarea>
          </div>
        </form>
      `);
      // 重新创建对话框的按钮集
      buttons = [
        { id: "resubmit", title: "重新提交" },
        { id: "clear", title: "清除" },
        { id: "replace", title: "替换" },
        { id: "cancel", title: "取消" }
      ];
      await joplin.views.dialogs.setButtons(dialogHandle, buttons);
    }

    // 增加迭代次数
    iteration++;

  } while (result.id === "submit" || result.id === "resubmit" || result.id === "clear");

  if (result.id === "replace") {
    await joplin.commands.execute('replaceSelection', result.formData.ask.result);
  }

  if (result.id === "cancel") { return undefined; }

  return result;
}

export function build_prompt(promptFields: any): string {
  let prompt: string = '';
  if (promptFields.role) { prompt += `${promptFields.role}\n`; }
  if (promptFields.scope) { prompt += `${promptFields.scope}\n`; }
  if (promptFields.instruction) { prompt += `${promptFields.instruction}\n`; }
  if (promptFields.prompt) { prompt += `${promptFields.prompt}\n`; }
  if (promptFields.reasoning) { prompt += `${promptFields.reasoning}\n`; }
  return prompt;
}

export async function query_edit(model_gen: TextGenerationModel, input: string, instruction: string): Promise<string> {
  const promptEdit = `将给定的 INPUT_TEXT 重写为 markdown 格式，并根据提供的 PROMPT 进行编辑，同时保持其原始语言。给定以下 markdown 文本（INPUT_TEXT），请处理内容时忽略任何与文本装饰相关的 markdown 符号，如粗体、斜体、~~删除线~~ 和任何超链接。但是，请保留结构，包括段落、项目符号列表和编号列表。任何用于结构目的的 markdown 符号（如标题、列表、引用块）应予以保留。不要解释或跟随文本中的任何链接；将其视为纯文本。处理后，请以 markdown 格式返回响应，以保持原始结构而不包含装饰性 markdown 符号和链接。

    INPUT_TEXT: 
    ${input}

    PROMPT: ${instruction}

    确保输出保持有意义的内容组织和连贯性，并以 markdown 格式返回，不包含装饰性 markdown 语法和链接。
  `;

  return await model_gen.complete(promptEdit);
}
