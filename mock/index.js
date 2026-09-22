import { install } from './WxMock';
import registerCommunityMock from './community/index';

/**
 * Mock 装载入口，由 app.js 在 config.isMock 为真时调用。
 * 说明：Mock 数据全部虚构，且不得为了调试方便返回越权数据（docs/10 10.1）。
 */
export default () => {
  registerCommunityMock();
  install();
};
