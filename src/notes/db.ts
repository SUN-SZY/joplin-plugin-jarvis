import joplin from 'api';
import { BlockEmbedding } from './embeddings';
const sqlite3 = joplin.require('sqlite3');
const fs = joplin.require('fs-extra');

// 连接到数据库
export async function connect_to_db(model: any): Promise<any> {
  await migrate_db();  // 如果需要，迁移数据库
  const plugin_dir = await joplin.plugins.dataDir();
  const db_fname = model.id.replace(/[/\\?%*:|"<>]/g, '_');
  const db = await new sqlite3.Database(plugin_dir + `/${db_fname}.sqlite`);

  // 检查模型版本
  let [check, model_idx] = await db_update_check(db, model);
  let choice = -1;
  if (check === 'new') {
    choice = await joplin.views.dialogs.showMessageBox('笔记数据库基于不同的模型。您是否希望重建它？（强烈推荐）');
  } else if (check === 'embedding_update') {
    choice = await joplin.views.dialogs.showMessageBox('笔记数据库基于较旧版本的嵌入。您是否希望重建它？（推荐）');
  } else if (check === 'model_update') {
    choice = await joplin.views.dialogs.showMessageBox('笔记数据库基于较旧版本的模型。您是否希望重建它？（推荐）');
  } else if (check === 'size_change') {
    choice = await joplin.views.dialogs.showMessageBox('笔记数据库基于不同的最大令牌值。您是否希望重建它？（可选）');
  }

  if (choice === 0) {
    // 确定（重建）
    db.close();
    await fs.remove(plugin_dir + `/${db_fname}.sqlite`);
    return await connect_to_db(model);

  } else if (choice === 1) {
    // 取消（保留现有）
    model_idx = await insert_model(db, model);
  }
  model.db_idx = model_idx;

  return db;
}

// 创建数据库表
export async function init_db(db: any, model: any): Promise<void> {
  if (await db_tables_exist(db)) {
    return;
  }
  // 创建嵌入表
  db.exec(`CREATE TABLE embeddings (
    idx INTEGER PRIMARY KEY,
    line INTEGER NOT NULL,
    body_idx INTEGER NOT NULL,
    length INTEGER NOT NULL,
    level INTEGER NOT NULL,
    title TEXT,
    embedding BLOB NOT NULL,
    note_idx INTEGER NOT NULL REFERENCES notes(idx),
    model_idx INTEGER NOT NULL REFERENCES models(idx)
  )`);

  // 创建笔记哈希表
  db.exec(`CREATE TABLE notes (
    idx INTEGER PRIMARY KEY,
    note_id TEXT NOT NULL UNIQUE,
    hash TEXT NOT NULL,
    UNIQUE (note_id, hash)
  )`);

  // 创建模型元数据表
  db.exec(`CREATE TABLE models (
    idx INTEGER PRIMARY KEY,
    model_name TEXT NOT NULL,
    model_version TEXT NOT NULL,
    max_block_size INT NOT NULL,
    embedding_version INTEGER NOT NULL DEFAULT 2,
    UNIQUE (model_name, model_version, max_block_size, embedding_version)
  )`);

  // 添加模型元数据
  insert_model(db, model);
}

// 检查嵌入和笔记表是否存在
async function db_tables_exist(db: any): Promise<boolean> {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.all(`SELECT name FROM sqlite_master WHERE type='table'`, (err, rows: {name: string}[]) => {
        if (err) {
          reject(err);
        } else {
          // 检查嵌入和笔记是否存在
          let embeddings_exist = false;
          let notes_exist = false;
          for (let row of rows) {
            if (row.name === 'embeddings') {
              embeddings_exist = true;
            }
            if (row.name === 'notes') {
              notes_exist = true;
            }
          }
          resolve(embeddings_exist && notes_exist);
        }
      });
    });
  });
}

// 比较数据库中的模型元数据与插件中的模型元数据
async function db_update_check(db: any, model: any): Promise<[String, number]> {
  if (!(await db_tables_exist(db))) {
    return ['OK', 0];
  }
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.all(`SELECT idx, model_name, model_version, max_block_size, embedding_version FROM models`,
          (err, rows: {
            idx: number,
            model_name: string,
            embedding_version: number
            model_version: string,
            max_block_size: number,
          }[]) => {
        if (err) {
          reject(err);
        } else {
          // 检查模型元数据是否存在于表中
          // 如果任何行匹配模型元数据，则返回 OK
          let model_exists = false;
          let model_update = true;
          let embedding_update = true;
          let model_size_change = true;
          let model_idx = 0;

          for (let row of rows) {

            if (row.model_name === model.id) {
              model_exists = true;

              if (row.embedding_version === model.embedding_version) {
                embedding_update = false;

                if (row.model_version === model.version) {
                  model_update = false;

                  if (row.max_block_size === model.max_block_size) {
                    model_size_change = false;
                    model_idx = row.idx;
                  }
                }
              }
            }
          }

          if (!model_exists) {
            resolve(['new', 0]);
          }
          if (embedding_update) {
            resolve(['embedding_update', 0]);
          }
          if (model_update) {
            resolve(['model_update', 0]);
          }
          if (model_size_change) {
            resolve(['size_change', 0]);
          } else {
            resolve(['OK', model_idx]);
          }
        }
      });
    });
  });
}

// 从数据库中获取所有笔记的所有嵌入。
// 首先，将笔记表和嵌入表连接起来。
// 然后，返回一个 BlockEmbedding 数组。
export async function get_all_embeddings(db: any): Promise<BlockEmbedding[]> {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.all(`SELECT note_id, hash, line, body_idx, length, level, title, embedding FROM notes JOIN embeddings ON notes.idx = embeddings.note_idx`,
          (err, rows: {note_id: string, hash: string, line: string, body_idx: number, length: number, level: number, title: string, embedding: Buffer}[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows.map((row) => {
            // 将嵌入从 blob 转换为 Float32Array
            const buffer = Buffer.from(row.embedding);
            const embedding = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
            return {
              id: row.note_id,
              hash: row.hash,
              line: parseInt(row.line, 10),
              body_idx: row.body_idx,
              length: row.length,
              level: row.level,
              title: row.title,
              embedding: embedding,
              similarity: 0,
            };
          }));
        }
      });
    });
  });
}

function insert_model(db: any, model: any): Promise<number> {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO models (model_name, model_version, max_block_size) VALUES ('${model.id}', '${model.version}', ${model.max_block_size})`, function(error) {
      if (error) {
        console.error('connect_to_db 错误:', error);
        reject(error);
      } else {
        resolve(this.lastID);
      }
    });
  });
}

// 将新笔记插入数据库，如果已存在则更新其哈希。
// 返回数据库中笔记的 ID。
export async function insert_note(db: any, note_id: string, hash: string): Promise<number> {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`INSERT OR REPLACE INTO notes (note_id, hash) VALUES (?, ?)`, [note_id, hash], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    });
  });
}

// 将单个笔记的新嵌入插入数据库。检查笔记哈希是否更改。
// 如果哈希更改，则删除该笔记的所有嵌入并插入新的嵌入。
// 如果笔记没有嵌入，则插入新的嵌入。
export async function insert_note_embeddings(db: any, embeds: BlockEmbedding[], model: any): Promise<void> {
  const embeddings = embeds;
  // 检查嵌入是否包含单个 note_id
  if (embeddings.length === 0) {
    return;
  }
  for (let embd of embeddings) {
    if ((embd.id !== embeddings[0].id) || (embd.hash !== embeddings[0].hash)) {
      throw new Error('insert_note_embeddings: 嵌入包含多个笔记');
    }
  }

  return new Promise((resolve, reject) => {
    db.serialize(async () => {
      const note_status = await get_note_status(db, embeddings[0].id, embeddings[0].hash);
      if (note_status.isUpToDate) {
        // 无需更新嵌入
        resolve();
      }
      const new_row_id = await insert_note(db, embeddings[0].id, embeddings[0].hash);  // 插入或更新
      // 删除旧的嵌入
      db.run(`DELETE FROM embeddings WHERE note_idx = ?`, [note_status.rowID], (err) => {
        if (err) {
          reject(err);
        } else {
          // 插入新的嵌入
          const stmt = db.prepare(`INSERT INTO embeddings (note_idx, line, body_idx, length, level, title, embedding, model_idx) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
          for (let embd of embeddings) {
            stmt.run([new_row_id, embd.line, embd.body_idx, embd.length, embd.level, embd.title, Buffer.from(embd.embedding.buffer), model.db_idx]);
          }
          stmt.finalize();
          resolve();
        }
      });
    });
  });
}
// 检查数据库中是否存在笔记。
// 如果存在，比较其哈希值与数据库中笔记的哈希值。
// 如果哈希值相同则返回 true，否则返回 false。
// 如果不存在于数据库中，则返回 false。
export async function get_note_status(db: any, note_id: string, hash: string): Promise<{isUpToDate: boolean, rowID: number | null}> {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.get(`SELECT idx, hash FROM notes WHERE note_id = ?`, [note_id], (err, row: {idx: number, hash: string}) => {
        if (err) {
          reject(err);
        } else if (row) {
          resolve({ isUpToDate: row.hash === hash, rowID: row.idx });
        } else {
          resolve({ isUpToDate: false, rowID: null });
        }
      });
    });
  });
}

// 从数据库中删除笔记及其嵌入。
export async function delete_note_and_embeddings(db: any, note_id: string): Promise<void> {
  const note_status = await get_note_status(db, note_id, '');
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`DELETE FROM notes WHERE note_id = ?`, [note_id], (err) => {
        if (err) {
          reject(err);
        } else if (note_status.rowID !== null) {
          db.run(`DELETE FROM embeddings WHERE note_idx = ?`, [note_status.rowID], (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        }
      });
    });
  });
}

export async function clear_deleted_notes(embeddings: BlockEmbedding[], db: any):
    Promise<BlockEmbedding[]> {
  // 获取所有现有笔记 ID
  let page = 0;
  let notes: any;
  let note_ids = [];
  do {
    page += 1;
    try {
      notes = await joplin.data.get(['notes'], { fields: ['id', 'deleted_time'], page: page });
    } catch {
      notes = await joplin.data.get(['notes'], { fields: ['id'], page: page });
    }
    note_ids = note_ids.concat(notes.items
      .filter((note: any) => (note.deleted_time === null) || (note.deleted_time == 0))
      .map((note: any) => note.id));
  } while(notes.has_more);

  let deleted = [];
  let new_embeddings: BlockEmbedding[] = [];
  for (const embd of embeddings) {

    if (note_ids.includes(embd.id)) {
      new_embeddings.push(embd);

    } else if (!deleted.includes(embd.id)){
      delete_note_and_embeddings(db, embd.id);
      deleted.push(embd.id);
    }
  }

  console.log(`clear_deleted_notes: 从数据库中移除了 ${deleted.length} 篇笔记`);
  return new_embeddings;
}

// 将数据库迁移到最新版本。
async function migrate_db(): Promise<void> {
  const plugin_dir = await joplin.plugins.dataDir();
  const db_path_old = plugin_dir + '/embeddings.sqlite';
  if (!fs.existsSync(db_path_old)) { return; }

  const db_path_new = plugin_dir + '/Universal Sentence Encoder.sqlite';

  console.log(`migrate_db: 在 ${db_path_old} 找到旧数据库`);
  fs.renameSync(db_path_old, db_path_new);

  const db = await new sqlite3.Database(db_path_new);
  // 修改 models 表
  await db.run(`ALTER TABLE models ADD COLUMN max_block_size INT NOT NULL DEFAULT 512`);
  await db.close();
  await new Promise(res => setTimeout(res, 1000));  // 确保数据库已关闭
}
