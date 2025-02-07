import joplin from 'api';

export function with_timeout(msecs: number, promise: Promise<any>): Promise<any> {
  const timeout = new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new Error("超时"));
    }, msecs);
  });
  return Promise.race([timeout, promise]);
}

export async function timeout_with_retry(msecs: number,
    promise_func: () => Promise<any>, default_value: any = ''): Promise<any> {
  try {
    return await with_timeout(msecs, promise_func());
  } catch (error) {
    const choice = await joplin.views.dialogs.showMessageBox(`错误: 请求超时 (${msecs / 1000} 秒).\n点击确定重试。`);
    if (choice === 0) {
      // 确定按钮
      return await timeout_with_retry(msecs, promise_func);
    }
    // 取消按钮
    return default_value;
  }
}

// 提供一个按段落、句子、单词等分割的文本，
// 或者是一个完整的 [text]（然后使用 split_by 进行分割）。
// 返回一个二维数组，其中每一行的总标记数小于 max_tokens。
// 可选地，从文本末尾选择（prefer = 'last'）。
export function split_by_tokens(
  parts: Array<string>,
  model: { count_tokens: (text: string) => number },
  max_tokens: number,
  prefer: string = 'first',
  split_by: string = ' ',  // 可以为 null 以按字符分割
): Array<Array<string>> {

  // 预处理部分以确保每个部分小于 max_tokens
  function preprocess(part: string): Array<string> {
    const token_count = model.count_tokens(part);

    if (token_count <= max_tokens) { return [part]; }

    // 将部分分成两半
    let part_arr: any = part;
    const use_regex = (split_by !== null) &&
                      (part.split(split_by).length > 1);
    if (use_regex) {
      part_arr = part_arr.split(split_by);
    }

    const middle = Math.floor(part_arr.length / 2);
    let left_part = part_arr.slice(0, middle);
    let right_part = part_arr.slice(middle);

    if (use_regex) {
      left_part = left_part.join(split_by);
      right_part = right_part.join(split_by);
    }

    const left_split = preprocess(left_part);
    const right_split = preprocess(right_part);

    return [...left_split, ...right_split];
  }

  const small_parts = parts.map(preprocess).flat();

  // 获取每个文本的标记总数
  const token_counts = small_parts.map(text => model.count_tokens(text));
  if (prefer === 'last') {
    token_counts.reverse();
    small_parts.reverse();
  }

  // 合并部分，直到标记总数大于 max_tokens
  let selected: Array<Array<string>> = [];
  let token_sum = 0;
  let current_selection: Array<string> = [];

  for (let i = 0; i < token_counts.length; i++) {
    if (token_sum + token_counts[i] > max_tokens) {
      // 根据 prefer 选项返回累积的文本
      if (prefer === 'last') {
        current_selection.reverse();
      }
      selected.push(current_selection);
      current_selection = [];
      token_sum = 0;
    }

    current_selection.push(small_parts[i]);
    token_sum += token_counts[i];
  }

  if (current_selection.length > 0) {
    // 根据 prefer 选项返回累积的文本
    if (prefer === 'last') {
      current_selection.reverse();
    }
    selected.push(current_selection);
  }

  return selected;
}

export async function consume_rate_limit(
    model: { requests_per_second: number, request_queue: Array<any>, last_request_time: number }) {
  /*
    1. 每个 embed() 调用都会创建一个 request_promise 并将请求对象添加到 requestQueue。
    2. 对于每个 embed() 调用，都会调用 consume_rate_limit() 方法。
    3. consume_rate_limit() 方法检查 requestQueue 中是否有待处理的请求。
    4. 如果有待处理的请求，方法会根据速率限制和自上次请求以来经过的时间计算必要的等待时间。
    5. 如果计算出的等待时间大于零，方法会使用 setTimeout() 等待指定的持续时间。
    6. 等待期结束后，方法通过从队列中移除并解决相关 promise 来处理 requestQueue 中的下一个请求。
    7. 解决的 promise 允许相应的 embed() 调用继续进行并为文本生成嵌入。
    8. 如果 requestQueue 中有其他待处理的请求，consume_rate_limit() 方法会再次调用以处理下一个请求。
    9. 此过程会一直持续到 requestQueue 中的所有请求都被处理。
  */
  const now = Date.now();
  const time_elapsed = now - model.last_request_time;

  // 计算请求之间的等待时间
  const wait_time = model.request_queue.length * (1000 / model.requests_per_second);

  if (time_elapsed < wait_time) {
    await new Promise((resolve) => setTimeout(resolve, wait_time - time_elapsed));
  }

  model.last_request_time = now;

  // 处理队列中的下一个请求
  if (model.request_queue.length > 0) {
    const request = model.request_queue.shift();
    request.resolve(); // 解决请求 promise
  }
}

export function search_keywords(text: string, query: string): boolean {
  // 将查询拆分为单词/短语
  const parts = preprocess_query(query).match(/"[^"]+"|\S+/g) || [];

  // 构建单词/短语的正则表达式模式
  const patterns = parts.map(part => {
      if (part.startsWith('"') && part.endsWith('"')) {
        // 匹配确切短语
        return `(?=.*\\b${part.slice(1, -1)}\\b)`;
      } else if (part.endsWith('*')) {
        // 匹配前缀（移除 '*' 并不要求末尾的单词边界）
        return `(?=.*\\b${part.slice(0, -1)})`;
      } else {
        // 匹配单个关键词
        return `(?=.*\\b${part}\\b)`;
      }
  });

  // 将模式组合成一个单一的正则表达式
  const regex = new RegExp(patterns.join(''), 'is');

  // 如果所有关键词/短语都被找到，则返回 true，否则返回 false
  return regex.test(text);
}

function preprocess_query(query: string) {
  const operators = [
    'any', 'title', 'body', 'tag', 'notebook',
    'created', 'updated', 'due', 'type', 'iscompleted',
    'latitude', 'longitude', 'altitude', 'resource',
    'sourceurl', 'id'
  ];

  // 构建匹配 <operator>:<keyword> 的正则表达式模式
  const regexPattern = new RegExp(`\\b(?:${operators.join('|')}):\\S+`, 'g');

  // 从查询中移除 <operator>:<keyword> 模式
  return query.replace(regexPattern, '').trim();
}

export async function get_all_tags(): Promise<Array<string>> {
  // TODO: 获取所有笔记中使用的 *标签*
  const tags: Array<string> = [];
  let page = 0;
  let some_tags: any;

  do {
    page += 1;
    some_tags = await joplin.data.get(['tags'], { fields: ['title'], page: page });

    tags.push(...some_tags.items.map((tag: any) => tag.title));
  } while(some_tags.has_more);

  return tags;
}

export function escape_regex(string: string): string {
  return string
    .replace(/---/g, '')  // 忽略分隔线
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .trim();
}

// 替换字符串中最后一次出现的模式
export function replace_last(str: string, pattern: string, replacement: string): string {
  const index = str.lastIndexOf(pattern);
  if (index === -1) return str;  // 模式未找到，返回原始字符串

  // 构造新字符串
  return str.substring(0, index) + replacement + str.substring(index + pattern.length);
}
