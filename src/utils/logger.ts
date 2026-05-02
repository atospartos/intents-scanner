import fs from 'fs';
import path from 'path';

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

type LogLevel = 'error' | 'warn' | 'trade' | 'info' | 'debug';

const LOG_LEVEL: LogLevel = 'info';
const LOG_TO_FILE = true;
const LOG_DIR = path.join(__dirname, '../../logs');

if (LOG_TO_FILE && !fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const levelPriority: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  trade: 2,
  info: 3,
  debug: 4,
};

const currentPriority = levelPriority[LOG_LEVEL];

function getTimestamp(): string {
  return new Date().toLocaleTimeString('ru-RU', { hour12: false });
}

function log(level: LogLevel, message: string, data?: any): void {
  if (levelPriority[level] > currentPriority) return;
  
  const timestamp = getTimestamp();
  let color = colors.reset;
  let emoji = '';
  
  switch (level) {
    case 'error': color = colors.red; emoji = '❌ '; break;
    case 'warn': color = colors.yellow; emoji = '⚠️ '; break;
    case 'trade': color = colors.magenta; emoji = '💰 '; break;
    case 'info': color = colors.green; emoji = '✅ '; break;
    case 'debug': color = colors.gray; emoji = '🔍 '; break;
  }
  
  const formattedMessage = `${timestamp} ${color}${emoji}${message}${colors.reset}`;
  console.log(formattedMessage);
  
  if (LOG_TO_FILE && data) {
    const logEntry = { timestamp: new Date().toISOString(), level, message, data };
    const logFile = path.join(LOG_DIR, `${new Date().toISOString().split('T')[0]}.log`);
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
  }
}

export const logger = {
  error: (message: string, data?: any) => log('error', message, data),
  warn: (message: string, data?: any) => log('warn', message, data),
  trade: (message: string, data?: any) => log('trade', message, data),
  info: (message: string, data?: any) => log('info', message, data),
  debug: (message: string, data?: any) => log('debug', message, data),
};