import log from 'electron-log/main';
import { getConfigValue } from './config';

const level = getConfigValue('debugMode') ? 'debug' : 'info';
log.transports.console.level = level;
log.transports.file.level = level;

export default log;
