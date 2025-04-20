import winston from 'winston';
import path from 'path';
import os from 'os';

const logDir = process.env.NODE_ENV === 'production'
  ? path.join(
      process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'PhotoMigrator')
        : path.join(os.homedir(), 'AppData', 'Local', 'PhotoMigrator'),
      'logs'
    )
  : path.join(process.cwd(), 'logs');

const logFormat = winston.format.printf(({ level, message, label, timestamp }) => {
  return `${timestamp} [${label}] ${level}: ${message}`;
});

export function createLogger(module: string) {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.label({ label: module }),
      winston.format.timestamp(),
      logFormat
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp(),
          logFormat
        ),
      }),
      new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
      }),
      new winston.transports.File({
        filename: path.join(logDir, 'combined.log'),
      }),
    ],
  });
}

export const logger = createLogger('app'); 