import { formatActiveTime, formatCost, formatCount, formatTokens } from './aggregate.js';

const ALLOWED_ELEMENT_TYPES = new Set(['div', 'span', 'img']);
const FORBIDDEN_DATA_KEYS = new Set([
  'type',
  'key',
  'windowData',
  'layoutFull',
  'taskAlias',
  'link',
  'border',
  '__proto__',
  'constructor',
  'prototype',
  'project',
]);

function formatUpdatedAt(date) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date).replaceAll('/', '-');
}

function displayUnits(character) {
  return character.codePointAt(0) >= 0x1100 ? 2 : 1;
}

function truncateDisplayText(value, maxUnits) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim() || '未知';
  const units = [...text].reduce((total, character) => total + displayUnits(character), 0);
  if (units <= maxUnits) return text;
  let result = '';
  let used = 0;
  for (const character of text) {
    const width = displayUnits(character);
    if (used + width + 1 > maxUnits) break;
    result += character;
    used += width;
  }
  return `${result}…`;
}

function primaryUsageLine(tool, model) {
  const toolName = tool ? truncateDisplayText(tool.name, model ? 19 : 43) : '';
  const modelName = model ? truncateDisplayText(model.name, tool ? 21 : 43) : '';
  if (!toolName && !modelName) return '暂无使用记录';
  return [toolName, modelName].filter(Boolean).join(' · ');
}

function metric(label, value, alignment = 'start') {
  const alignmentClass = {
    start: 'items-start',
    center: 'items-center',
    end: 'items-end',
  }[alignment];
  return {
    type: 'div',
    props: {
      tw: `flex flex-col flex-1 min-w-0 gap-[1px] ${alignmentClass}`,
      children: [
        { type: 'span', props: { tw: 'text-10-chillduansans', children: label } },
        {
          type: 'span',
          props: {
            tw: 'text-12-chillduansans font-bold min-w-0',
            style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
            children: value,
          },
        },
      ],
    },
  };
}

export function buildCanvasPayload(summary, now = new Date()) {
  const mainHasData = summary.main.hasAnyData;
  const data = {
    updatedAt: formatUpdatedAt(now),
    mainTokens: mainHasData ? formatTokens(summary.main.totalTokens) : '暂无数据',
    mainCost: formatCost(summary.main.estimatedCost),
    mainSessions: formatCount(summary.main.sessionCount),
    mainActive: formatActiveTime(summary.main.activeSeconds),
    secondaryTokens: summary.secondary.hasAnyData ? formatTokens(summary.secondary.totalTokens) : '暂无数据',
    secondaryCost: formatCost(summary.secondary.estimatedCost),
    primaryUsage: primaryUsageLine(summary.main.topTools[0], summary.main.topModels[0]),
  };

  const windowData = {
    default: [
      {
        type: 'div',
        props: {
          tw: 'flex flex-col w-full h-full min-w-0 min-h-0 bg-white text-black gap-[4px]',
          children: [
            {
              type: 'div',
              props: {
                tw: 'flex flex-row items-center justify-between shrink-0 text-10-chillduansans',
                children: [
                  {
                    type: 'span',
                    props: { tw: 'font-bold', style: { letterSpacing: '0.5px' }, children: 'VIBE USAGE' },
                  },
                  {
                    type: 'span',
                    props: {
                      style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
                      children: '{{get inputData "updatedAt" default="--"}}',
                    },
                  },
                ],
              },
            },
            {
              type: 'div',
              props: {
                tw: 'flex flex-row flex-1 min-h-0 items-center gap-[8px]',
                children: [
                  {
                    type: 'div',
                    props: {
                      tw: 'flex flex-col flex-1 min-w-0 justify-center',
                      children: [
                        {
                          type: 'div',
                          props: {
                            tw: 'flex flex-row items-center gap-[5px]',
                            children: [
                              {
                                type: 'span',
                                props: {
                                  tw: 'text-11-chillduansans font-bold',
                                  children: summary.ranges.main.label,
                                },
                              },
                              {
                                type: 'span',
                                props: { tw: 'text-10-chillduansans', style: { letterSpacing: '0.4px' }, children: 'TOKEN' },
                              },
                            ],
                          },
                        },
                        {
                          type: 'span',
                          props: {
                            tw: 'text-[40px]-chillduansans font-bold leading-none min-w-0',
                            style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
                            children: '{{get inputData "mainTokens" default="暂无数据"}}',
                          },
                        },
                      ],
                    },
                  },
                  {
                    type: 'div',
                    props: {
                      tw: 'flex flex-col w-[88px] min-w-0 items-start justify-center gap-[2px]',
                      children: [
                        {
                          type: 'span',
                          props: {
                            tw: 'text-11-chillduansans font-bold min-w-0',
                            style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
                            children: summary.ranges.secondary.label,
                          },
                        },
                        {
                          type: 'span',
                          props: {
                            tw: 'text-[22px]-chillduansans font-bold leading-none min-w-0',
                            style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
                            children: '{{get inputData "secondaryTokens" default="暂无数据"}}',
                          },
                        },
                        {
                          type: 'span',
                          props: {
                            tw: 'text-11-chillduansans min-w-0',
                            style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
                            children: '费用 {{get inputData "secondaryCost" default="$0.00"}}',
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
            {
              type: 'div',
              props: {
                tw: 'flex flex-row shrink-0 justify-between gap-[10px] min-w-0',
                style: { paddingTop: '5px' },
                children: [
                  metric('费用', '{{get inputData "mainCost" default="$0.00"}}', 'start'),
                  metric('会话', '{{get inputData "mainSessions" default="0"}}', 'center'),
                  metric('活跃', '{{get inputData "mainActive" default="0秒"}}', 'end'),
                ],
              },
            },
            {
              type: 'div',
              props: {
                tw: 'flex flex-row shrink-0 items-center min-w-0 gap-[6px] text-10-chillduansans',
                children: [
                  {
                    type: 'span',
                    props: {
                      tw: 'font-bold shrink-0 text-10-chillduansans',
                      children: '主力',
                    },
                  },
                  {
                    type: 'span',
                    props: {
                      tw: 'min-w-0',
                      style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
                      children: '{{get inputData "primaryUsage" default="暂无使用记录"}}',
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    ],
  };

  return {
    refreshNow: true,
    taskAlias: 'Vibe Usage',
    border: 0,
    data,
    windowData,
  };
}

function visitElements(value, types) {
  if (Array.isArray(value)) {
    for (const child of value) visitElements(child, types);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if ('type' in value) {
    if (!ALLOWED_ELEMENT_TYPES.has(value.type)) throw new Error(`不支持的画板元素：${value.type}`);
    types.add(value.type);
  }
  for (const child of Object.values(value)) visitElements(child, types);
}

export function validateCanvasPayload(payload, forbiddenValues = []) {
  if (payload.refreshNow !== true) throw new Error('refreshNow 必须为 true');
  if (payload.taskAlias !== 'Vibe Usage') throw new Error('taskAlias 必须为 Vibe Usage');
  if (payload.border !== 0) throw new Error('border 必须为 0');
  if (!payload.data || typeof payload.data !== 'object') throw new Error('缺少 data');
  for (const key of Object.keys(payload.data)) {
    if (FORBIDDEN_DATA_KEYS.has(key)) throw new Error(`data 包含禁用字段：${key}`);
  }
  if (!Array.isArray(payload.windowData?.default)) throw new Error('windowData.default 必须为数组');
  const types = new Set();
  visitElements(payload.windowData.default, types);
  const serialized = JSON.stringify(payload);
  if (/project/i.test(serialized)) throw new Error('payload 不得包含 project');
  for (const secret of forbiddenValues.filter(Boolean)) {
    if (serialized.includes(String(secret))) throw new Error('payload 包含密钥');
  }
  return { elementTypes: [...types].sort(), bytes: Buffer.byteLength(serialized) };
}
