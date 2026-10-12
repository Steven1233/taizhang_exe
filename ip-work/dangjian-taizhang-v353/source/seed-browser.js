/**
 * 浏览器端数据播种脚本（用于说明书截图采集，仅写入 IndexedDB，不改动项目源码）
 *
 * 用法：在应用页面（同源）上通过浏览器 evaluate 执行本文件内容（IIFE，返回 Promise<string>）。
 * 作用：从同源静态路径拉取真实测试备份 JSON，按 db/index.ts 声明的 Dexie Schema（version 3）
 *      重建 PartyBuildingLedger 库并写入 members / meetings / operationLogs / talkRecords，
 *      随后需整页刷新（reload）使应用重新读取数据。
 */
(async () => {
  const URL = '/%E5%85%9A%E5%BB%BA%E5%B7%A5%E4%BD%9C%E5%8F%B0%E8%B4%A6_%E6%B5%8B%E8%AF%95%E6%95%B0%E6%8D%AE%E5%A4%87%E4%BB%BD.json';
  const DB = 'PartyBuildingLedger';

  // 1. 拉取真实备份数据
  const backup = await (await fetch(URL)).json();
  if (!backup || !backup.tables) throw new Error('备份数据格式异常');

  // 2. 清空旧库（关闭既有连接后删除）
  if (window.__seedDb) { try { window.__seedDb.close(); } catch (e) { /* ignore */ } }
  await new Promise((resolve) => {
    const del = indexedDB.deleteDatabase(DB);
    del.onsuccess = del.onerror = del.onblocked = () => resolve();
  });

  // 3. 按 db/index.ts 的 version 3 结构建库建索引（与 Dexie 声明完全一致）
  const openReq = indexedDB.open(DB, 3);
  openReq.onupgradeneeded = () => {
    const d = openReq.result;
    const members = d.createObjectStore('members', { keyPath: 'id' });
    members.createIndex('name', 'name');
    members.createIndex('department', 'department');
    members.createIndex('status', 'status');
    members.createIndex('partyGroup', 'partyGroup');
    members.createIndex('committeeRole', 'committeeRole');

    const meetings = d.createObjectStore('meetings', { keyPath: 'id' });
    meetings.createIndex('type', 'type', { multiEntry: true });
    meetings.createIndex('date', 'date');
    meetings.createIndex('host', 'host');

    const logs = d.createObjectStore('operationLogs', { keyPath: 'id' });
    logs.createIndex('timestamp', 'timestamp');
    logs.createIndex('type', 'type');

    const talks = d.createObjectStore('talkRecords', { keyPath: 'id' });
    talks.createIndex('talkDate', 'talkDate');
    talks.createIndex('type', 'type');
    talks.createIndex('talkerName', 'talkerName');
    talks.createIndex('targetName', 'targetName');
  };
  const db = await new Promise((resolve, reject) => {
    openReq.onsuccess = () => resolve(openReq.result);
    openReq.onerror = () => reject(openReq.error);
  });
  window.__seedDb = db;

  // 4. 事务写入四张表
  const names = ['members', 'meetings', 'operationLogs', 'talkRecords'];
  const tx = db.transaction(names, 'readwrite');
  const put = (store, rows) => { (rows || []).forEach((r) => tx.objectStore(store).put(r)); };
  put('members', backup.tables.members && backup.tables.members.data);
  put('meetings', backup.tables.meetings && backup.tables.meetings.data);
  put('operationLogs', backup.tables.operationLogs && backup.tables.operationLogs.data);
  put('talkRecords', backup.tables.talkRecords && backup.tables.talkRecords.data);
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  const counts = {};
  for (const n of names) {
    counts[n] = await new Promise((resolve, reject) => {
      const r = db.transaction(n, 'readonly').objectStore(n).count();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return 'SEED_OK ' + JSON.stringify(counts);
})();