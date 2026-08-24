import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import type { OperationType } from '../types';

export async function addLog(
  type: OperationType,
  description: string,
  detail: Record<string, unknown> = {},
  result: 'success' | 'failure' = 'success'
): Promise<void> {
  try {
    await db.operationLogs.add({
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      type,
      description,
      detail: JSON.stringify(detail),
      result,
    });
  } catch {
    console.error('写入操作日志失败');
  }
}