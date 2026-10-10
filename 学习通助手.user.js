// ==UserScript==
// @name 学习通学习助手（分享框架版）
// @version 1.0.0
// @author BZM (框架分享版)
// @license Apache
// @description 学习通助手（分享框架版）：AI大模型/题库接口自动答题并自动填选（含选择题、多选题），搜不到自动转人工问答。密钥由使用者自己在面板配置，脚本不内置任何密钥。保留视频任务、字体解密、防检测、面板拖动等原有功能。
// @match *://*.chaoxing.com/*
// @run-at document-end
// @grant unsafeWindow
// @grant GM_xmlhttpRequest
// @grant GM_setValue
// @grant GM_getValue
// @grant GM_deleteValue
// @grant GM_info
// @grant GM_getResourceText
// @grant GM_openInTab
// @icon http://pan-yz.chaoxing.com/favicon.ico
// @original-script https://scriptcat.org/zh-CN/script-show-page/5717
// @require https://cdn.bootcdn.net/ajax/libs/jquery/3.7.1/jquery.min.js
// @require https://cdn.bootcdn.net/ajax/libs/limonte-sweetalert2/11.1.0/sweetalert2.all.min.js
// @resource Table https://pkpkq.n1t.cn/font-decrypt/Table.json
// @require https://pkpkq.n1t.cn/font-decrypt/TyprMd5.js
// @connect pkpkq.n1t.cn
// @connect *
// @tag 自动答题
// @tag 人工问答
// @tag 开源框架
// ==/UserScript==

/********************************* 反检测层 ****************************************/
(function() {
    'use strict';
    try {
        Object.defineProperty(navigator, 'webdriver', { get: function() { return undefined; }, configurable: true });
    } catch(e) {}
    try {
        if (!window.chrome) window.chrome = {};
        if (!window.chrome.runtime) window.chrome.runtime = {};
    } catch(e) {}
    try {
        Object.defineProperty(document, 'visibilityState', { get: function() { return 'visible'; }, configurable: true });
        Object.defineProperty(document, 'hidden', { get: function() { return false; }, configurable: true });
        document.hasFocus = function() { return true; };
        document.addEventListener('visibilitychange', function(e) { e.stopImmediatePropagation(); }, true);
    } catch(e) {}
    try {
        window.onblur = null;
        window.onfocus = null;
        ['blur', 'focus', 'pagehide', 'pageshow'].forEach(function(evt) {
            window.addEventListener(evt, function(e) { e.stopImmediatePropagation(); }, true);
        });
    } catch(e) {}
    var _OrigMO = window.MutationObserver;
    if (_OrigMO) {
        window.MutationObserver = function(callback) {
            var wrappedCallback = function(mutations, observer) {
                var delay = 50 + Math.random() * 150;
                setTimeout(function() { callback(mutations, observer); }, delay);
            };
            return new _OrigMO(wrappedCallback);
        };
        window.MutationObserver.prototype = _OrigMO.prototype;
    }
    try {
        var _origQuery = navigator.permissions && navigator.permissions.query;
        if (_origQuery) {
            navigator.permissions.query = function(desc) {
                if (desc && desc.name === 'notifications') {
                    return Promise.resolve({ state: 'prompt', onchange: null });
                }
                return _origQuery.call(navigator.permissions, desc);
            };
        }
    } catch(e) {}
    console.log('[学习通助手] 反检测层已加载');
})();

/********************************* 配置管理器 ****************************************/
var SettingsManager = {
    _defaults: {
        showBox: 1,
        showMaskImg: 1,
        taskOnly: 0,
        handleVideo: 1,
        handleAudio: 1,
        videoRate: 1,
        videoMode: 'simulate',
        showProgressBar: 1,
        reviewMode: 0,
        handleQuiz: 1,
        handleVideoQuiz: 1,
        answerInterval: 5000,
        autoSubmit: 0,
        forceSubmit: 0,
        decryptFont: 1,
        autoNextExam: 1,
        examNextDelay: 1,
        insertAnswer: 1,
        autoSearch: 1,
        autoLogin: 0,
        loginPhone: '',
        loginPassword: ''
    },
    get: function(key) {
        var gv = GM_getValue('setting_' + key, null);
        if (gv !== null && gv !== undefined) { this._defaults[key] = gv; return gv; }
        var stored = localStorage.getItem('setting_' + key);
        if (stored !== null) {
            if (stored === 'true') return true;
            if (stored === 'false') return false;
            if (!isNaN(parseFloat(stored)) && isFinite(stored)) return parseFloat(stored);
            return stored;
        }
        return this._defaults[key];
    },
    set: function(key, value) {
        localStorage.setItem('setting_' + key, value);
        GM_setValue('setting_' + key, value);
        this._defaults[key] = value;
        return value;
    },
    load: function() {
        for (var key in this._defaults) {
            var v = this.get(key);
            if (v !== undefined) this._defaults[key] = v;
        }
        if (this._defaults.videoRate > 8) this._defaults.videoRate = 8;
        return this._defaults;
    },
    saveVideoMode: function(mode) { this.set('videoMode', mode); GM_setValue('videoMode', mode); },
    saveVideoRate: function(rate) { if (rate > 8) rate = 8; this.set('videoRate', rate); GM_setValue('videoRate', rate); },
    saveProgressBar: function(show) { this.set('showProgressBar', show ? 1 : 0); GM_setValue('showProgressBar', show ? 1 : 0); }
};

var CONFIG = SettingsManager.load();
if (CONFIG.videoRate > 8) CONFIG.videoRate = 8;

function updateConfig(key, value) {
    var oldValue = CONFIG[key];
    CONFIG[key] = SettingsManager.set(key, value);
    if (key === 'videoRate' && CONFIG.videoRate > 8) { CONFIG.videoRate = 8; SettingsManager.set('videoRate', 8); }
    log('⚙️ 配置已更新: ' + key + ' = ' + value + (oldValue !== value ? ' (已生效)' : ''), 'blue');
}

function getRandomInterval() {
    var base = CONFIG.answerInterval || 5000;
    return Math.floor(base * (0.8 + Math.random() * 0.7));
}

/********************************* 多选题智能匹配核心 ****************************************/
function matchMultiChoiceIndices(optsText, answer) {
    var ansArr = splitAnswer(answer);
    var normalizedOpts = optsText.map(function(opt) { return normalizeForCompare(opt); });
    var normalizedAnsArr = ansArr.map(function(a) { return normalizeForCompare(a); }).filter(function(a) { return a !== ''; });
    var hitIdx = [];
    normalizedOpts.forEach(function(opt, i) {
        for (var j = 0; j < normalizedAnsArr.length; j++) {
            if (opt === normalizedAnsArr[j] && hitIdx.indexOf(i) === -1) { hitIdx.push(i); break; }
        }
    });
    if (hitIdx.length < normalizedAnsArr.length) {
        normalizedOpts.forEach(function(opt, i) {
            if (hitIdx.indexOf(i) !== -1) return;
            for (var j = 0; j < normalizedAnsArr.length; j++) {
                var na = normalizedAnsArr[j];
                if (na === '') continue;
                if (opt.indexOf(na) !== -1 && (opt.length - na.length) <= 1) { hitIdx.push(i); break; }
                if (na.indexOf(opt) !== -1 && (na.length - opt.length) <= 1) { hitIdx.push(i); break; }
            }
        });
    }
    if (hitIdx.length > normalizedAnsArr.length) hitIdx = hitIdx.slice(0, normalizedAnsArr.length);
    return hitIdx;
}

/********************************* 题型映射扩展 ****************************************/
var QuestionTypeMap = {
    0: ['单选题', '单项选择题', '单选', '选择题'],
    1: ['多选题', '多项选择题', '多选'],
    2: ['填空题', '填空'],
    3: ['判断题', '是非题', '判断'],
    4: ['简答题', '简答', '问答题', '名词解释', '论述题', '论述', '计算题', '计算', '分录题', '资料题', '作图题', '其他', '其它', '阅读理解', '阅读', '阅读题', '理解题', '完形填空', '完形', '综合题']
};

function getQuestionTypeFromText(text) {
    if (!text) return undefined;
    for (var typeId = 0; typeId <= 4; typeId++) {
        var keywords = QuestionTypeMap[typeId];
        for (var i = 0; i < keywords.length; i++) {
            if (text.indexOf(keywords[i]) !== -1) return typeId;
        }
    }
    return undefined;
}

/********************************* 全局变量 ****************************************/
var UNSAFE_WIN = unsafeWindow;
var LOCATION = location;
var DOCUMENT = UNSAFE_WIN.document;
var $ = UNSAFE_WIN.jQuery || top.jQuery;
var UE = UNSAFE_WIN.UE;

// 人工问答模式：不再调用任何外部答题API
var pendingAnswerRequest = null;
var manualSelectedOptions = [];
var manualQuestionCount = 0;
var taskList = null;
var defaults = null;
var domList = null;
var submitBtn = null;
var saveBtn = null;
var frameContent = null;
var okBtn = null;
var reportUrlChange = 0;
var isProcessing = false;
var isBoxHidden = false;
var pikaqiuAdded = false;
var pendingMissionCount = 0;
var completedMissionCount = 0;
var isJumping = false;
var currentProcessingTask = null;
var totalMissionCount = 0;
var currentVideoInterval = null;
var currentVideoQuizObserver = null;
var quizObserverGuardTimer = null;
var quizPollTimer = null;
var hasTriggeredNoTaskJump = false;
var logQueue = [];
var logTimer = null;

// ==================== 选项清理函数 ====================
function cleanOptionText(text) {
    if (!text) return text;
    var cleaned = text.replace(/<[^>]*>/g, '');
    cleaned = cleaned.replace(/^[A-Z][\s]*[.、．）)\s]+/, '');
    cleaned = cleaned.replace(/^\([A-Z]\)[\s]*/, '');
    cleaned = cleaned.replace(/^（[A-Z]）[\s]*/, '');
    cleaned = cleaned.replace(/^[:\s\-_]+/, '');
    return cleaned.trim();
}
// 弹题选项专用清洗：反复剥 A、 A. A） (A) （A） 1. 1、 1） (1) （1） 等前缀
function cleanQuizOptionText(text) {
    if (!text) return '';
    var cleaned = String(text).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    for (var round = 0; round < 3; round++) {
        var before = cleaned;
        cleaned = cleaned.replace(/^\s*[A-Za-z]\s*[.、．,，:：)）]+\s*/, '');
        cleaned = cleaned.replace(/^\s*[（(]\s*[A-Za-z]\s*[）)]\s*/, '');
        cleaned = cleaned.replace(/^\s*\d+\s*[.、．,，:：)）]+\s*/, '');
        cleaned = cleaned.replace(/^\s*[（(]\s*\d+\s*[）)]\s*/, '');
        cleaned = cleaned.replace(/^\s*[A-Za-z]\s+/, '');
        if (cleaned === before) break;
    }
    return cleaned.trim();
}

function tidyString(s) {
    if (!s) return null;
    var cleaned = s.replace(/<(?!img).*?>/g, "").replace(/^【.*?】\s*/, '').replace(/\s*（\d+\.\d+分）$/, '').trim().replace(/&nbsp;/g, '');
    return cleanOptionText(cleaned);
}
function tidyQuestion(s) {
    if (!s) return null;
    var cleaned = s.replace(/<(?!img).*?>/g, "").replace(/^【.*?】\s*/, '').replace(/\s*（\d+\.\d+分）$/, '').replace(/^\d+[.、]/, '').trim();
    return cleanOptionText(cleaned);
}
function normalizeForCompare(text) {
    if (!text) return '';
    return text.toUpperCase().replace(/[^\u4e00-\u9fa5A-Z0-9]/g, '').trim();
}
function splitAnswer(answer) {
    if (!answer) return [];
    var parts = answer.split(/[#]+/).map(function(a) { return a.trim(); }).filter(function(a) { return a !== ''; });
    if (parts.length === 0 && answer.trim() !== '') return [answer.trim()];
    return parts;
}
function extractString(str, start, end) {
    var res = str.match(new RegExp(start + '(.*?)' + end));
    return res ? res[1] : null;
}
function getTopLogContainer() {
    try {
        var topDoc = top.document;
        var container = topDoc.getElementById('ne-21log');
        if (container) return $(container);
        container = document.getElementById('ne-21log');
        if (container) return $(container);
        return null;
    } catch(e) { return null; }
}
function flushLogs() {
    if (logQueue.length === 0) return;
    var container = getTopLogContainer();
    if (container && container.length) {
        var logsToShow = logQueue.slice();
        logQueue = [];
        for (var i = logsToShow.length - 1; i >= 0; i--) { container.prepend(logsToShow[i]); }
        container.scrollTop(0);
    }
    if (logTimer) { clearTimeout(logTimer); logTimer = null; }
}
function scheduleFlushLogs() { if (logTimer) return; logTimer = setTimeout(flushLogs, 100); }
function log(str, color) {
    var time = new Date().toLocaleTimeString();
    var logHtml = '<div style="border-top:1px solid #eee;padding:6px 0;"><span style="color:' + (color || '#000') + ';">[' + time + '] ' + str + '</span></div>';
    logQueue.push(logHtml);
    scheduleFlushLogs();
    console.log('[学习通助手][' + time + ']', str);
}
function showPikaqiu() {
    if (!CONFIG.showMaskImg) return;
    if (pikaqiuAdded) return;
    try {
        var targetDoc = top.document;
        if (targetDoc.querySelector('#pikaqiu-img')) return;
        var imgHtml = '<img id="pikaqiu-img" src="https://pkpkq.n1t.cn/pkq.gif" style="position:fixed;bottom:20px;left:20px;z-index:99999;width:100px;cursor:pointer;opacity:0.7;" title="学习通助手">';
        $(targetDoc.body).append(imgHtml);
        pikaqiuAdded = true;
        $('#pikaqiu-img', targetDoc).click(function() {
            var $box = $('#ne-21box', targetDoc);
            if ($box.length) {
                if ($box.css('display') === 'none') { $box.css('display', 'block'); isBoxHidden = false; }
                else { $box.css('display', 'none'); isBoxHidden = true; }
            }
        });
    } catch(e) {}
}
$(document).keydown(function(e) {
    if (e.keyCode == 120) {
        var $box = $('#ne-21box');
        if ($box.length === 0) return;
        if (isBoxHidden) { $box.css('display', 'block'); $box.css('opacity', '1'); isBoxHidden = false; log('📌 面板已显示', 'green'); }
        else { $box.css('display', 'none'); isBoxHidden = true; log('📌 面板已隐藏，按F9键恢复显示', 'blue'); }
    }
});

// ==================== 人工问答核心逻辑 ====================
function manualTargetDoc() {
    try { return top.document; } catch(e) { return document; }
}
function typeNameById(t) {
    var m = {0:'单选题',1:'多选题',2:'填空题',3:'判断题',4:'简答题'};
    return m[t] || ('题型' + t);
}
function formatQuestionForCopy(type, text, options) {
    var s = '【' + typeNameById(type) + '】' + (text || '');
    if (options && options.length && (type === 0 || type === 1)) {
        var letters = 'ABCDEFGHIJKLMNOP';
        s += '\n选项：';
        options.forEach(function(o, i) { s += '\n' + (letters[i] || (i + 1)) + '. ' + o; });
    }
    return s;
}
function copyTextToClipboard(text) {
    try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) log('📋 题目已复制，粘贴到AI对话框即可提问', 'green');
        return ok;
    } catch(e) { return false; }
}
function renderPendingQuestionUI() {
    var doc = manualTargetDoc();
    var req = pendingAnswerRequest;
    var box = doc.getElementById('ne-21box');
    if (box) { box.style.display = 'block'; }
    var area = doc.getElementById('ne-21pending');
    if (!area) return;
    var letters = 'ABCDEFGHIJKLMNOP';
    var optionsHtml = '';
    if (req && req.options && req.options.length && (req.type === 0 || req.type === 1 || req.type === 3)) {
        optionsHtml = '<div style="margin:8px 0;">' + req.options.map(function(opt, i) {
            var label = (req.type === 3 && (opt === '对' || opt === '错')) ? opt : ((letters[i] || (i + 1)) + '. ' + opt);
            return '<button type="button" data-manual-opt="' + i + '" style="padding:5px 10px;margin:0 4px 4px 0;border:1px solid #bbb;border-radius:4px;background:#fff;cursor:pointer;">' + label + '</button>';
        }).join('') + '</div>' +
        '<div id="manualMultiTip" style="font-size:12px;color:#e6a23c;margin:4px 0;display:none;">💡 多选题：点选多个选项后，再点「填入答案」确认</div>';
    }
    var qTitle = '暂无待答题目';
    var qBody = '';
    if (req) { qTitle = '【' + typeNameById(req.type) + '】'; qBody = (req.text || ''); }
    area.innerHTML =
        '<div style="background:#fffbe6;border:1px solid #ffe58f;border-left:4px solid #faad14;border-radius:6px;padding:10px;margin-bottom:12px;">' +
        '<div style="font-weight:bold;margin-bottom:6px;">🤖 人工问答 <span style="font-size:11px;color:#999;font-weight:normal;">(答案填好后脚本自动选择)</span></div>' +
        '<div id="manualQuestionText" style="white-space:pre-wrap;max-height:140px;overflow-y:auto;font-size:13px;margin-bottom:6px;"><b>' + qTitle + '</b>' + qBody + '</div>' +
        optionsHtml +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
        '<input type="text" id="manualAnswerInput" placeholder="填答案，如 A / 对 / 答案文字；多空用#分隔" style="flex:1;min-width:150px;padding:6px;border:1px solid #ddd;border-radius:4px;">' +
        '<button id="submitManualAnswerBtn" style="padding:6px 12px;background:#4CAF50;color:#fff;border:none;border-radius:4px;cursor:pointer;">填入答案</button>' +
        '<button id="copyQuestionBtn" style="padding:6px 12px;background:#2196F3;color:#fff;border:none;border-radius:4px;cursor:pointer;">复制题目去问AI</button>' +
        '<button id="skipQuestionBtn" style="padding:6px 12px;background:#999;color:#fff;border:none;border-radius:4px;cursor:pointer;">跳过/随机</button>' +
        '</div>' +
        '<div id="manualHint" style="font-size:12px;color:#999;margin-top:6px;">' + (req ? ('第 ' + req.count + ' 个待答问题：拿到答案后填回来，脚本会自动选择') : '') + '</div>' +
        '</div>';
    if (req && req.type === 1) { var tip = doc.getElementById('manualMultiTip'); if (tip) tip.style.display = 'block'; }
    flushLogs();
}
function ensureManualBindings(doc) {
    if (doc.__manualBindings) return;
    doc.__manualBindings = true;
    doc.addEventListener('click', function(e) {
        var t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('[data-manual-opt]')) {
            var idx = parseInt(t.closest('[data-manual-opt]').getAttribute('data-manual-opt'), 10);
            quickPickManualOption(idx);
            return;
        }
        if (t.closest('#submitManualAnswerBtn')) { submitManualAnswer(); return; }
        if (t.closest('#copyQuestionBtn')) { copyPendingQuestion(); return; }
        if (t.closest('#skipQuestionBtn')) { skipPendingQuestion(); return; }
    });
    doc.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && doc.activeElement && doc.activeElement.id === 'manualAnswerInput') {
            e.preventDefault();
            submitManualAnswer();
        }
    });
}
function renderPendingOptionsHighlight(doc) {
    var btns = doc.querySelectorAll('[data-manual-opt]');
    for (var i = 0; i < btns.length; i++) {
        var bi = parseInt(btns[i].getAttribute('data-manual-opt'), 10);
        if (manualSelectedOptions.indexOf(bi) !== -1) { btns[i].style.background = '#4CAF50'; btns[i].style.color = '#fff'; }
        else { btns[i].style.background = '#fff'; btns[i].style.color = '#000'; }
    }
}
function expandLetterAnswer(answer, options, questionType) {
    if (!answer || !options || !options.length) return answer;
    if (questionType === 2 || questionType === 4) return answer;
    var letters = answer.toUpperCase().trim().replace(/[\s,，、;；]+/g, '');
    if (letters.length < 1 || letters.length > 8) return answer;
    if (!/^[A-H]+$/.test(letters)) return answer;
    var mapped = [];
    var seen = {};
    for (var i = 0; i < letters.length; i++) {
        var li = letters.charCodeAt(i) - 65;
        if (li >= 0 && li < options.length && !seen[li]) { seen[li] = true; mapped.push(options[li]); }
    }
    return mapped.length ? mapped.join('#') : answer;
}
function resolvePendingAnswer(answer, skipped) {
    var req = pendingAnswerRequest;
    if (!req) return;
    pendingAnswerRequest = null;
    manualSelectedOptions = [];
    var doc = manualTargetDoc();
    var area = doc.getElementById('ne-21pending');
    if (area) { area.style.display = 'none'; area.innerHTML = ''; }
    if (skipped) {
        log('⏭️ 用户选择跳过', 'orange');
        req.reject('用户跳过');
    } else {
        answer = (typeof answer === 'string') ? answer.trim() : answer;
        answer = expandLetterAnswer(answer, req.options, req.type);
        log('🤖 收到人工答案: ' + answer, 'purple');
        req.resolve(answer);
    }
}
function quickPickManualOption(idx) {
    var req = pendingAnswerRequest;
    if (!req || !req.options || idx < 0 || idx >= req.options.length) return;
    if (req.type === 1) {
        var pos = manualSelectedOptions.indexOf(idx);
        if (pos !== -1) { manualSelectedOptions.splice(pos, 1); }
        else { manualSelectedOptions.push(idx); }
        renderPendingOptionsHighlight(manualTargetDoc());
        log('📌 多选题已选 ' + manualSelectedOptions.length + ' 项，确认后点「填入答案」', 'blue');
        return;
    }
    resolvePendingAnswer(req.options[idx], false);
}
function submitManualAnswer() {
    var req = pendingAnswerRequest;
    if (!req) return;
    var doc = manualTargetDoc();
    var input = doc.getElementById('manualAnswerInput');
    var answer = '';
    if ((req.type === 0 || req.type === 1) && manualSelectedOptions.length > 0) {
        answer = manualSelectedOptions.map(function(i) { return req.options[i]; }).join('#');
    } else if (input && input.value) {
        answer = input.value;
    }
    if (!answer || !answer.trim()) { log('⚠️ 请先点选选项或输入答案', 'orange'); return; }
    resolvePendingAnswer(answer, false);
}
function copyPendingQuestion() {
    var req = pendingAnswerRequest;
    if (!req) return;
    var ok = copyTextToClipboard(formatQuestionForCopy(req.type, req.text, req.options));
    if (!ok) log('⚠️ 复制失败，请手动选中题目文本', 'orange');
}
function skipPendingQuestion() {
    var req = pendingAnswerRequest;
    if (!req) return;
    resolvePendingAnswer(null, true);
}
function askForAnswer(questionType, questionText, optionsData) {
    return new Promise(function(resolve, reject) {
        pendingAnswerRequest = {
            type: questionType,
            text: questionText || '',
            options: optionsData || [],
            resolve: resolve,
            reject: reject,
            count: ++manualQuestionCount
        };
        manualSelectedOptions = [];
        ensureManualBindings(manualTargetDoc());
        renderPendingQuestionUI();
        log('🤖 等待人工答案：' + typeNameById(questionType) + ' | ' + String(questionText || '').substring(0, 50), 'purple');
    });
}
function getSubmitDecision() {
    if (CONFIG.autoSubmit) { return { action: 'submit', reason: '自动提交' }; }
    else if (CONFIG.forceSubmit) { return { action: 'submit', reason: '强制提交' }; }
    else { return { action: 'save', reason: '自动保存' }; }
}
function getAnswer(questionType, questionText, optionsData, retryCount) {
    if (CONFIG.autoSearch && getApiUrlList().length) {
        return searchAnswerOnline(questionType, questionText, optionsData).then(function(answer) {
            return expandLetterAnswer(answer, optionsData || [], questionType);
        }).catch(function(err) {
            log('🔍 自动搜索未找到答案，转为人工问答: ' + err, 'orange');
            return askForAnswer(questionType, questionText, optionsData);
        });
    }
    return askForAnswer(questionType, questionText, optionsData);
}

// ==================== 框架配置区（使用者可改） ====================
// 说明：
// - api_mode: 'ai' = 大模型接口；'bank' = 题库接口
// - 分享版不内置任何密钥，首次使用请打开脚本面板，在「自动搜题」区
//   填入自己的 API 密钥后点「存密钥」，并可用「测试」验证接口
var DEFAULT_API_URLS = [];                                  // 自定义接口地址（多个用逗号分隔）
var DEFAULT_AI_BASE_URL = 'https://api.mxwell.ai/v1';      // AI模式默认中转地址（可改）
var DEFAULT_API_MODEL = 'deepseek-v4-flash-0731';          // AI模式默认模型（可改）
var DEFAULT_API_KEY = '';                                  // 内置密钥：分享版留空，由使用者面板配置
var DEFAULT_DEEPSEEK_URL = 'https://api.deepseek.com';     // 兜底：DeepSeek官方接口
var DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';              // 兜底模型
function getApiMode() { return GM_getValue('api_mode', 'ai'); }
function getApiModel() { return GM_getValue('api_model', DEFAULT_API_MODEL); }
function getApiUrlList() {
    var raw = GM_getValue('api_url', '');
    var list = [];
    if (raw && raw.trim()) {
        list = raw.split(/[,，;；]+/).map(function(u) { return u.trim(); }).filter(function(u) { return u !== ''; });
    }
    if (!list.length && getApiMode() === 'ai') { list = [DEFAULT_AI_BASE_URL]; }
    return list;
}
function saveApiUrls(urlsText) {
    var list = String(urlsText || '').split(/[,，;；]+/).map(function(u) { return u.trim(); }).filter(function(u) { return u !== ''; });
    GM_setValue('api_url', list.join(','));
    return list;
}
function saveApiConfig(urlsText, model) {
    if (model && model.trim()) { GM_setValue('api_model', model.trim()); }
    return saveApiUrls(urlsText);
}
function getApiKey() {
    var saved = GM_getValue('api_key', '');
    return (saved && saved.trim()) ? saved : DEFAULT_API_KEY;
}
function searchAnswerOnline(questionType, questionText, optionsData) {
    if (getApiMode() === 'ai') { return searchAnswerWithAI(questionType, questionText, optionsData); }
    return searchQuestionBank(questionType, questionText, optionsData);
}
function searchQuestionBank(questionType, questionText, optionsData) {
    var urls = getApiUrlList();
    var typeMap = {0:'单选题',1:'多选题',2:'填空题',3:'判断题',4:'简答题'};
    var typeText = typeMap[questionType] || '单选题';
    var apiKey = getApiKey();
    return new Promise(function(resolve, reject) {
        function tryUrl(i) {
            if (i >= urls.length) { reject('所有接口均未搜到答案'); return; }
            var url = urls[i];
            var formData = 'question=' + encodeURIComponent(questionText || '') + '&type=' + encodeURIComponent(typeText);
            if (apiKey && apiKey.trim()) { formData += '&key=' + encodeURIComponent(apiKey.trim()); }
            if (optionsData && optionsData.length) { formData += '&options=' + encodeURIComponent(JSON.stringify(optionsData)); }
            if (i === 0) log('🔍 自动搜索答案：' + typeText + ' | ' + String(questionText || '').substring(0, 40), 'blue');
            var timer = setTimeout(function() { tryUrl(i + 1); }, 12000);
            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                data: formData,
                timeout: 12000,
                onload: function(xhr) {
                    clearTimeout(timer);
                    try {
                        var res = JSON.parse(xhr.responseText);
                        if (res.code == 1) {
                            var answer = null;
                            if (Array.isArray(res.data) && res.data.length > 0) {
                                if (res.data[0].answer) { answer = res.data[0].answer; }
                                else if (res.data[0].question && res.data[0].question !== '抱歉无答案') { answer = res.data[0].question; }
                            } else if (typeof res.data === 'string') { answer = res.data; }
                            else if (res.data && typeof res.data === 'object' && res.data.answer) { answer = res.data.answer; }
                            if (answer && String(answer).trim() !== '' && !String(answer).includes('无答案') && String(answer).toLowerCase() !== 'none') {
                                log('✅ 自动搜到答案: ' + answer, 'purple');
                                resolve(answer);
                                return;
                            }
                        }
                        log('⚠️ 接口' + (i + 1) + '无答案，尝试下一个', 'orange');
                        tryUrl(i + 1);
                    } catch(e) { tryUrl(i + 1); }
                },
                onerror: function() { clearTimeout(timer); tryUrl(i + 1); },
                ontimeout: function() { clearTimeout(timer); tryUrl(i + 1); }
            });
        }
        tryUrl(0);
    });
}
function buildAiPrompt(questionType, questionText, optionsData) {
    var typeName = typeNameById(questionType);
    var prompt = '你是一个学习答题助手。请根据题目给出正确答案。\n题型：' + typeName + '\n题目：' + (questionText || '');
    if (questionType === 0) {
        prompt += '\n选项：\n' + (optionsData || []).map(function(o, i) { return String.fromCharCode(65 + i) + '. ' + o; }).join('\n');
        prompt += '\n请只输出选项字母，例如：B';
    } else if (questionType === 1) {
        prompt += '\n选项：\n' + (optionsData || []).map(function(o, i) { return String.fromCharCode(65 + i) + '. ' + o; }).join('\n');
        prompt += '\n请只输出正确选项字母组合，例如：AC';
    } else if (questionType === 3) {
        prompt += '\n请只输出：对 或 错';
    } else if (questionType === 2) {
        prompt += '\n题目共 ' + ((optionsData && optionsData[0]) || '?') + ' 个空，请只输出填空答案，多个空用 # 分隔，例如：答案1#答案2';
    } else {
        prompt += '\n请直接输出答案内容，不要解释。';
    }
    return prompt;
}
function cleanAiAnswer(answer) {
    if (!answer) return answer;
    var s = String(answer).trim();
    s = s.replace(/^```[a-z]*\s*/, '').replace(/\s*```$/, '').trim();
    s = s.replace(/^(答案|正确答案|选择|选项)[:：]?\s*/i, '');
    s = s.replace(/^(选|为|是)\s*/i, '');
    s = s.replace(/[。！]+$/, '');
    var compact = s.replace(/[,，、\s.．;；:：和]+/g, '');
    if (/^[A-H]+$/i.test(compact)) { return compact.toUpperCase(); }
    return s;
}
function extractAiAnswer(res) {
    if (!res) return '';
    if (res.output && Array.isArray(res.output)) {
        var texts = [];
        res.output.forEach(function(item) {
            if (!item || item.type !== 'message' || !Array.isArray(item.content)) return;
            item.content.forEach(function(part) {
                if (part && (part.type === 'output_text' || part.type === 'text') && typeof part.text === 'string' && part.text.trim()) {
                    texts.push(part.text.trim());
                }
            });
        });
        if (texts.length) return texts.join(' ');
    }
    if (res.choices && res.choices[0]) {
        var c = res.choices[0];
        if (c.message && typeof c.message.content === 'string' && c.message.content.trim()) return c.message.content.trim();
        if (typeof c.text === 'string' && c.text.trim()) return c.text.trim();
    }
    return '';
}
function searchAnswerWithAI(questionType, questionText, optionsData) {
    var urls = getApiUrlList();
    var model = getApiModel();
    var apiKey = getApiKey();
    if (!apiKey || !apiKey.trim()) {
        return Promise.reject('未配置API密钥，请在面板填写');
    }
    var prompt = buildAiPrompt(questionType, questionText, optionsData);
    log('🤖 正在问 AI (' + model + ')：' + typeNameById(questionType) + ' | ' + String(questionText || '').substring(0, 40), 'blue');
    return new Promise(function(resolve, reject) {
        function tryUrl(i) {
            if (i >= urls.length) { deepseekFallback(); return; }
            var base = String(urls[i]).replace(/\/+$/, '');
            var payload = { model: model, input: prompt };
            var timer = setTimeout(function() { tryUrl(i + 1); }, 60000);
            GM_xmlhttpRequest({
                method: 'POST',
                url: base + '/responses',
                headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey},
                data: JSON.stringify(payload),
                timeout: 60000,
                onload: function(xhr) {
                    clearTimeout(timer);
                    try {
                        var res = JSON.parse(xhr.responseText);
                        var answer = cleanAiAnswer(extractAiAnswer(res));
                        if (answer && answer.toLowerCase() !== 'none' && !answer.includes('无答案')) {
                            log('🤖 AI返回答案: ' + answer, 'purple');
                            resolve(answer);
                            return;
                        }
                    } catch(e) {}
                    log('⚠️ AI接口' + (i + 1) + '未返回有效答案，尝试下一个', 'orange');
                    tryUrl(i + 1);
                },
                onerror: function() { clearTimeout(timer); tryUrl(i + 1); },
                ontimeout: function() { clearTimeout(timer); tryUrl(i + 1); }
            });
        }
        function deepseekFallback() {
            log('⚠️ mxwell接口未返回答案，改用DeepSeek官方接口...', 'orange');
            GM_xmlhttpRequest({
                method: 'POST',
                url: DEFAULT_DEEPSEEK_URL + '/chat/completions',
                headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getApiKey()},
                data: JSON.stringify({ model: DEFAULT_DEEPSEEK_MODEL, messages: [{ role: 'user', content: prompt }] }),
                timeout: 60000,
                onload: function(xhr) {
                    try {
                        var res = JSON.parse(xhr.responseText);
                        var answer = cleanAiAnswer(extractAiAnswer(res));
                        if (answer) {
                            log('🤖 DeepSeek官方返回答案: ' + answer, 'purple');
                            resolve(answer);
                            return;
                        }
                    } catch(e) {}
                    reject('mxwell与DeepSeek官方均未返回答案');
                },
                onerror: function() { reject('DeepSeek官方网络请求失败'); },
                ontimeout: function() { reject('DeepSeek官方请求超时'); }
            });
        }
        tryUrl(0);
    });
}
function testApiConnection() {
    var urls = getApiUrlList();
    if (!urls.length) { return Promise.reject('未配置接口'); }
    var apiKey = getApiKey();
    if (getApiMode() === 'ai') {
        var model = getApiModel();
        if (!apiKey || !apiKey.trim()) { return Promise.reject('未配置API密钥，请在面板填写'); }
        return new Promise(function(resolve, reject) {
            var i = 0;
            var lastErr = '';
            function next() {
                if (i >= urls.length) { deepseekTest(); return; }
                var base = String(urls[i++]).replace(/\/+$/, '');
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: base + '/responses',
                    headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey},
                    data: JSON.stringify({ model: model, input: '只回答：测试成功' }),
                    timeout: 30000,
                    onload: function(xhr) {
                        try {
                            var res = JSON.parse(xhr.responseText);
                            if (res.error) {
                                lastErr = 'HTTP ' + xhr.status + ' ' + (res.error.message || res.error.code || '接口报错');
                                next(); return;
                            }
                            if (extractAiAnswer(res)) { resolve(base + ' / ' + model); return; }
                            lastErr = '返回内容无法解析';
                            next();
                        } catch(e) { lastErr = '响应解析失败'; next(); }
                    },
                    onerror: function() { lastErr = '网络请求被拦截或失败'; next(); },
                    ontimeout: function() { lastErr = '请求超时(30秒)'; next(); }
                });
            }
            function deepseekTest() {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: DEFAULT_DEEPSEEK_URL + '/chat/completions',
                    headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getApiKey()},
                    data: JSON.stringify({ model: DEFAULT_DEEPSEEK_MODEL, messages: [{ role: 'user', content: '只回答：测试成功' }] }),
                    timeout: 30000,
                    onload: function(xhr) {
                        try {
                            var res = JSON.parse(xhr.responseText);
                            if (extractAiAnswer(res)) {
                                resolve('DeepSeek官方 / ' + DEFAULT_DEEPSEEK_MODEL);
                                return;
                            }
                        } catch(e) {}
                        reject('所有AI接口测试失败' + (lastErr ? '：' + lastErr : '：DeepSeek官方返回无法解析'));
                    },
                    onerror: function() { reject('所有AI接口测试失败' + (lastErr ? '：' + lastErr : '：DeepSeek官方网络失败')); },
                    ontimeout: function() { reject('所有AI接口测试失败：DeepSeek官方超时'); }
                });
            }
            next();
        });
    }
    return new Promise(function(resolve, reject) {
        var i = 0;
        function next() {
            if (i >= urls.length) { reject('所有接口测试失败'); return; }
            var url = urls[i++];
            var formData = 'question=' + encodeURIComponent('test') + '&type=' + encodeURIComponent('单选题');
            if (apiKey && apiKey.trim()) { formData += '&key=' + encodeURIComponent(apiKey.trim()); }
            GM_xmlhttpRequest({
                method: 'POST', url: url,
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                data: formData, timeout: 10000,
                onload: function(xhr) {
                    try {
                        var res = JSON.parse(xhr.responseText);
                        if (res.code == 1 || res.code == 400) { resolve(url); return; }
                        next();
                    } catch(e) { next(); }
                },
                onerror: function() { next(); },
                ontimeout: function() { next(); }
            });
        }
        next();
    });
}

// ==================== 视频弹题核心逻辑 ====================
function isVideoQuizPopup(node) {
    if (!node || node.nodeType !== 1) return false;
    var hasTitle = node.querySelector && (
        node.querySelector('.TiMu') ||
        node.querySelector('.ans-videoquiz') ||
        node.querySelector('.ans-videoquiz-title') ||
        node.querySelector('.videoquiz') ||
        node.querySelector('.ans-videoquiz-opt')
    );
    var hasInput = node.querySelector && (
        node.querySelector('input[type=radio]') ||
        node.querySelector('input[type=checkbox]') ||
        node.querySelector('.ans-videoquiz-opt label')
    );
    if (hasTitle && hasInput) return true;
    var txt = node.textContent || '';
    if ((txt.indexOf('题') !== -1 || txt.indexOf('选择') !== -1) &&
        node.querySelectorAll && node.querySelectorAll('input[type=radio],input[type=checkbox]').length > 0) {
        return true;
    }
    return false;
}

function extractVideoQuiz(popupEl) {
    var titleEl = popupEl.querySelector('.TiMu') ||
                  popupEl.querySelector('.ans-videoquiz-title') ||
                  popupEl.querySelector('.videoquiz-title') ||
                  popupEl.querySelector('.ans-videoquiz') ||
                  popupEl;
    var title = (titleEl.textContent || '').trim();
    var options = [];
    var inputs = popupEl.querySelectorAll('input[type=radio],input[type=checkbox]');
    if (inputs.length) {
        inputs.forEach(function(input, idx) {
            var label = input.closest('label') || input.parentElement;
            var raw = (label.textContent || '').trim();
            options.push({
                index: idx,
                text: cleanQuizOptionText(raw),
                rawText: raw,
                type: input.type,
                el: input
            });
        });
    } else {
        var liList = popupEl.querySelectorAll('.ans-videoquiz-opt li, .ans-videoquiz-opt label');
        liList.forEach(function(el, idx) {
            var raw = (el.textContent || '').trim();
            options.push({
                index: idx,
                text: cleanQuizOptionText(raw),
                rawText: raw,
                type: 'click',
                el: el
            });
        });
    }
    var qType = 'single';
    if (popupEl.querySelector('input[type=checkbox]')) qType = 'multiple';
    else if (popupEl.querySelector('.ans-videoquiz-opt .dui, .panduan')) qType = 'judge';
    return { title: title, options: options, type: qType, popup: popupEl };
}

function getSecFont() {
    try {
        var styleEl = document.querySelector("style[type='text/css']");
        if (!styleEl) return null;
        var m = styleEl.textContent.match(/'(data:application\/font-ttf;.*?)'/);
        return m ? m[1] : null;
    } catch(e) { return null; }
}
function decryptVideoQuizFont(popupEl) {
    return new Promise(function(resolve) {
        if (!CONFIG.decryptFont) { resolve(); return; }
        var nodes = popupEl.querySelectorAll('.font-cxsecret');
        if (!nodes.length) { resolve(); return; }
        var secFont = getSecFont();
        if (!secFont) { resolve(); return; }
        var pending = nodes.length;
        nodes.forEach(function(node) {
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://pkpkq.n1t.cn/font-decrypt/decrypt.php',
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({ secFont: secFont, dstText: (node.textContent || '').trim() }),
                onload: function(res) {
                    try {
                        var data = JSON.parse(res.responseText);
                        if (data && data.srcText) node.textContent = data.srcText;
                    } catch(e) {}
                    if (--pending === 0) resolve();
                },
                onerror: function() { if (--pending === 0) resolve(); },
                ontimeout: function() { if (--pending === 0) resolve(); }
            });
        });
    });
}

function clickOpt(opt) {
    try {
        if (opt.el) {
            if (opt.el.click) opt.el.click();
            var label = opt.el.closest && opt.el.closest('label');
            if (label && label.click) label.click();
        }
    } catch(e) {}
}

function fillVideoQuizAnswer(quiz, answer) {
    var qType = quiz.type;
    var opts = quiz.options;
    if (!opts.length) return false;
    if (qType === 'judge') {
        var isTrue = /对|正确|是|√|T/i.test(answer);
        var targetIdx = isTrue ? 0 : 1;
        if (opts[targetIdx]) { clickOpt(opts[targetIdx]); return true; }
    }
    if (qType === 'multiple') {
        var optsText = opts.map(function(o) { return o.text; });
        var hitIdx = matchMultiChoiceIndices(optsText, answer);
        if (hitIdx.length > 0) {
            hitIdx.forEach(function(i) { clickOpt(opts[i]); });
            return true;
        }
        return false;
    }
    // 单选：严格相等 → 包含且长度差≤1 → rawText 兜底
    var ansArr = splitAnswer(answer);
    var clicked = false;
    opts.forEach(function(opt) {
        var normOpt = normalizeForCompare(opt.text);
        for (var i = 0; i < ansArr.length; i++) {
            if (normOpt === normalizeForCompare(ansArr[i])) { clickOpt(opt); clicked = true; break; }
        }
    });
    if (clicked) return true;
    opts.forEach(function(opt) {
        var normOpt = normalizeForCompare(opt.text);
        for (var i = 0; i < ansArr.length; i++) {
            var normAns = normalizeForCompare(ansArr[i]);
            if (normOpt.indexOf(normAns) !== -1 && normOpt.length - normAns.length <= 1) { clickOpt(opt); clicked = true; break; }
            if (normAns.indexOf(normOpt) !== -1 && normAns.length - normOpt.length <= 1) { clickOpt(opt); clicked = true; break; }
        }
    });
    if (clicked) return true;
    opts.forEach(function(opt) {
        var normRaw = normalizeForCompare(opt.rawText);
        for (var i = 0; i < ansArr.length; i++) {
            if (normRaw === normalizeForCompare(ansArr[i])) { clickOpt(opt); clicked = true; break; }
        }
    });
    return clicked;
}

function randomPickVideoQuiz(quiz) {
    var opts = quiz.options || [];
    if (!opts.length) return false;
    if (quiz.type === 'multiple') {
        var pickCount = 1 + Math.floor(Math.random() * opts.length);
        var pool = opts.slice();
        for (var k = 0; k < pickCount && pool.length > 0; k++) {
            var pi = Math.floor(Math.random() * pool.length);
            clickOpt(pool[pi]);
            pool.splice(pi, 1);
        }
        log('🎲 多选题随机选择了 ' + pickCount + ' 项', 'orange');
        return true;
    }
    var ri = Math.floor(Math.random() * opts.length);
    clickOpt(opts[ri]);
    log('🎲 随机选择第 ' + (ri + 1) + ' 项: ' + opts[ri].text, 'orange');
    return true;
}

function submitVideoQuiz(popupEl) {
    var submitBtn2 = popupEl.querySelector('.ans-videoquiz-submit, .submit-btn, .confirm, button[type=submit]');
    if (submitBtn2) {
        setTimeout(function() { submitBtn2.click(); log('📤 弹题已提交', 'green'); }, 500 + Math.random() * 500);
    }
}

function resumeVideoWhenQuizGone(popupEl, video) {
    var done = false;
    function resume() {
        if (done) return;
        done = true;
        if (video && video.paused) {
            video.play().then(function() { log('▶️ 视频已恢复播放', 'blue'); }).catch(function(){});
        }
    }
    try {
        var mo = new MutationObserver(function() {
            if (!popupEl.isConnected) { mo.disconnect(); resume(); }
        });
        mo.observe(popupEl.parentNode || document.body, { childList: true, subtree: true });
    } catch(e) {}
    setTimeout(resume, 8000);
    var t = setInterval(function() {
        if (!popupEl.isConnected || popupEl.style.display === 'none') {
            clearInterval(t); resume();
        }
    }, 500);
    setTimeout(function() { clearInterval(t); resume(); }, 12000);
}

function handleVideoQuiz(popupEl) {
    if (!CONFIG.handleVideoQuiz) return;
    if (!popupEl || popupEl.dataset.videoQuizHandled === 'true') return;
    popupEl.dataset.videoQuizHandled = 'true';
    log('🎯 检测到视频弹题，开始处理...', 'purple');
    var doc = popupEl.ownerDocument || document;
    var video = doc.querySelector('video');
    if (video && !video.paused) video.pause();
    decryptVideoQuizFont(popupEl).then(function() {
        var quiz = extractVideoQuiz(popupEl);
        log('📖 弹题题干: ' + quiz.title.substring(0, 60) + ' | 题型: ' + quiz.type, 'blue');
        log('🔎 清洗后的弹题选项: ' + JSON.stringify(quiz.options.map(function(o){return o.text;})), 'blue');
        var typeId = 0;
        if (quiz.type === 'multiple') typeId = 1;
        else if (quiz.type === 'judge') typeId = 3;
        var optsText = quiz.options.map(function(o) { return o.text; });
        var optionsData = (typeId === 3) ? ["对", "错"] : optsText;
        getAnswer(typeId, quiz.title, optionsData).then(function(answer) {
            log('🤖 人工答案: ' + answer, 'purple');
            if (!answer || answer === '暂无答案') {
                log('⚠️ 弹题未获取到答案，随机选择一项提交', 'orange');
                randomPickVideoQuiz(quiz);
            } else {
                var filled = fillVideoQuizAnswer(quiz, answer);
                if (!filled) {
                    log('⚠️ 弹题答案未匹配到选项，随机选择提交', 'orange');
                    randomPickVideoQuiz(quiz);
                } else {
                    log('✅ 弹题已作答: ' + answer, 'green');
                }
            }
            submitVideoQuiz(popupEl);
            resumeVideoWhenQuizGone(popupEl, video);
        }).catch(function(err) {
            log('⚠️ 弹题获取答案失败: ' + err + '，随机作答', 'orange');
            randomPickVideoQuiz(quiz);
            submitVideoQuiz(popupEl);
            resumeVideoWhenQuizGone(popupEl, video);
        });
    });
}

function observeVideoQuiz(doc) {
    if (!CONFIG.handleVideoQuiz) return;
    if (currentVideoQuizObserver) { try { currentVideoQuizObserver.disconnect(); } catch(e) {} currentVideoQuizObserver = null; }
    if (!doc || !doc.body) return;
    var existings = doc.querySelectorAll('.ans-videoquiz, .TiMu, .videoquiz');
    existings.forEach(function(el) { if (isVideoQuizPopup(el)) handleVideoQuiz(el); });
    currentVideoQuizObserver = new MutationObserver(function(mutations) {
        if (!CONFIG.handleVideoQuiz) return;
        mutations.forEach(function(m) {
            m.addedNodes.forEach(function(node) {
                if (node.nodeType !== 1) return;
                if (isVideoQuizPopup(node)) {
                    handleVideoQuiz(node);
                } else if (node.querySelectorAll) {
                    var inner = node.querySelectorAll('.ans-videoquiz, .TiMu, .videoquiz');
                    inner.forEach(function(el) { if (isVideoQuizPopup(el)) handleVideoQuiz(el); });
                }
            });
        });
    });
    currentVideoQuizObserver.observe(doc.body, { childList: true, subtree: true });
    doc.__quizObserverAlive = true;
    var oldDisconnect = currentVideoQuizObserver.disconnect.bind(currentVideoQuizObserver);
    currentVideoQuizObserver.disconnect = function() {
        try { doc.__quizObserverAlive = false; } catch(e) {}
        oldDisconnect();
    };
    log('👀 视频弹题监听已启动', 'blue');
}

function startQuizObserverGuard() {
    if (quizObserverGuardTimer) return;
    quizObserverGuardTimer = setInterval(function() {
        if (!CONFIG.handleVideoQuiz) return;
        try {
            document.querySelectorAll('iframe').forEach(function(f) {
                var d;
                try { d = f.contentDocument || (f.contentWindow && f.contentWindow.document); } catch(e) { return; }
                if (!d || !d.body) return;
                if (!d.querySelector('video')) return;
                if (d.__quizObserverAlive) return;
                observeVideoQuiz(d);
                log('🔄 弹题监听断线重连', 'blue');
            });
        } catch(e) {}
    }, 3000);
}
function stopQuizObserverGuard() {
    if (quizObserverGuardTimer) { clearInterval(quizObserverGuardTimer); quizObserverGuardTimer = null; }
}
function startQuizPoll(doc) {
    if (quizPollTimer) clearInterval(quizPollTimer);
    quizPollTimer = setInterval(function() {
        if (!CONFIG.handleVideoQuiz) return;
        try {
            var pops = doc.querySelectorAll('.ans-videoquiz, .TiMu, .videoquiz');
            pops.forEach(function(el) {
                if (isVideoQuizPopup(el) && el.dataset.videoQuizHandled !== 'true') {
                    handleVideoQuiz(el);
                }
            });
        } catch(e) {}
    }, 1500);
}
function stopQuizPoll() {
    if (quizPollTimer) { clearInterval(quizPollTimer); quizPollTimer = null; }
}

function getBlankCount($question) {
    var count = 0;
    var $inputs = $question.find('.blankList2 input, input[type="text"][name*="answer"]');
    if ($inputs.length) {
        var uniqueIdentifiers = new Set();
        $inputs.each(function() {
            var name = $(this).attr('name');
            var id = $(this).attr('id');
            if (name) { uniqueIdentifiers.add(name); }
            else if (id) { uniqueIdentifiers.add(id); }
            else { var parentHtml = $(this).parent().html() || ''; uniqueIdentifiers.add($(this).index() + '_' + parentHtml.substring(0, 50)); }
        });
        count = uniqueIdentifiers.size;
        if (count > 0) return count;
    }
    var $editorBlocks = $question.find('[data-editorindex]');
    if ($editorBlocks.length) {
        var uniqueIndices = new Set();
        $editorBlocks.each(function() {
            var idx = $(this).attr('data-editorindex');
            if (idx !== undefined && idx !== null && idx !== '') { uniqueIndices.add(idx); }
        });
        count = uniqueIndices.size;
        if (count > 0) return count;
    }
    var $pcInputs = $question.find('.Zy_ulTk .XztiHover1 textarea, .stem_answer .Answer .divText .textDIV textarea, .subEditor textarea');
    if ($pcInputs.length) {
        var uniquePCInputs = new Set();
        $pcInputs.each(function() {
            var id = $(this).attr('id');
            var name = $(this).attr('name');
            if (id) { uniquePCInputs.add(id); }
            else if (name) { uniquePCInputs.add(name); }
            else { uniquePCInputs.add($(this).index()); }
        });
        count = uniquePCInputs.size;
        if (count > 0) return count;
    }
    return count === 0 ? 1 : count;
}
function fillBlankAnswer($question, answers, isPhoneMode, contextWindow) {
    var answerList = splitAnswer(answers);
    log('📝 填空题答案: ' + answerList.join(' | '), 'blue');
    if (isPhoneMode) {
        var $allInputs = $question.find('.blankList2 input, input[type="text"][name*="answer"]');
        if ($allInputs.length) {
            var uniqueInputs = [];
            var seen = new Set();
            $allInputs.each(function() {
                var name = $(this).attr('name');
                var id = $(this).attr('id');
                var key = name || id || $(this).index();
                if (!seen.has(key)) { seen.add(key); uniqueInputs.push(this); }
            });
            log('📝 找到 ' + uniqueInputs.length + ' 个填空输入框，准备填写', 'blue');
            $(uniqueInputs).each(function(i) {
                setTimeout(function() {
                    var answerValue = answerList[i] !== undefined ? answerList[i] : (answerList[0] || '');
                    $(this).val(answerValue);
                    $(this).trigger('input').trigger('change');
                    log('✅ 填空题第' + (i+1) + '空已填写: ' + answerValue, 'green');
                }.bind(this), i * 200);
            });
            return true;
        }
        var $editorBlocks = $question.find('[data-editorindex]');
        if ($editorBlocks.length) {
            var uniqueEditors = [];
            var seenIndices = new Set();
            $editorBlocks.each(function() {
                var idx = $(this).attr('data-editorindex');
                if (idx && !seenIndices.has(idx)) { seenIndices.add(idx); uniqueEditors.push(this); }
            });
            log('📝 找到 ' + uniqueEditors.length + ' 个编辑器，准备填写', 'blue');
            uniqueEditors.forEach(function(editor, i) {
                var editorIndex = $(editor).attr('data-editorindex');
                var itemId = $(editor).attr('data-itemid');
                setTimeout(function() {
                    try {
                        var ueditor = null;
                        if (contextWindow && contextWindow.editors && contextWindow.editors[editorIndex]) { ueditor = contextWindow.editors[editorIndex].ueditor; }
                        if (!ueditor && contextWindow && contextWindow.UE && contextWindow.UE.instants) { var instantKey = 'ueditorInstant' + editorIndex; ueditor = contextWindow.UE.instants[instantKey]; }
                        if (!ueditor && itemId && contextWindow && contextWindow.UE && contextWindow.UE.getEditor) { ueditor = contextWindow.UE.getEditor('ananas-editor-answer' + itemId); }
                        if (ueditor) {
                            var answerValue = answerList[i] !== undefined ? answerList[i] : (answerList[0] || '');
                            ueditor.setContent(answerValue);
                            log('✅ 填空题第' + (i+1) + '空已填写: ' + answerValue, 'green');
                        }
                        if (itemId) {
                            var answerValue = answerList[i] !== undefined ? answerList[i] : (answerList[0] || '');
                            $('#answer' + itemId).val(answerValue).trigger('change');
                        }
                    } catch(e) {}
                }, i * 300);
            });
            return true;
        }
    }
    var $pcInputs = $question.find('.Zy_ulTk .XztiHover1 textarea, .stem_answer .Answer .divText .textDIV textarea, .subEditor textarea');
    if ($pcInputs.length) {
        var uniquePCInputs = [];
        var seenPC = new Set();
        $pcInputs.each(function() {
            var id = $(this).attr('id');
            var name = $(this).attr('name');
            var key = id || name || $(this).index();
            if (!seenPC.has(key)) { seenPC.add(key); uniquePCInputs.push(this); }
        });
        log('📝 找到 ' + uniquePCInputs.length + ' 个填空输入框 (PC)，准备填写', 'blue');
        $(uniquePCInputs).each(function(i) {
            setTimeout(function() {
                var $this = $(this);
                var answerValue = answerList[i] !== undefined ? answerList[i] : (answerList[0] || '');
                if (UE && UE.getEditor && UE.getEditor($this.attr('id'))) { UE.getEditor($this.attr('id')).setContent(answerValue); }
                else { $this.val(answerValue); $this.trigger('input').trigger('change'); }
                log('✅ 填空题第' + (i+1) + '空已填写: ' + answerValue, 'green');
            }.bind(this), i * 200);
        });
        return true;
    }
    return false;
}
function fillShortAnswer($question, answer, isPhoneMode, contextWindow) {
    log('📝 简答题答案: ' + answer.substring(0, 100) + '...', 'blue');
    if (isPhoneMode) {
        var $editorBlocks = $question.find('[data-editorindex]');
        if ($editorBlocks.length) {
            $editorBlocks.each(function(i) {
                var editorIndex = $(this).attr('data-editorindex');
                var itemId = $(this).attr('data-itemid');
                setTimeout(function() {
                    try {
                        var ueditor = null;
                        if (contextWindow && contextWindow.editors && contextWindow.editors[editorIndex]) { ueditor = contextWindow.editors[editorIndex].ueditor; }
                        if (!ueditor && contextWindow && contextWindow.UE && contextWindow.UE.instants) { var instantKey = 'ueditorInstant' + editorIndex; ueditor = contextWindow.UE.instants[instantKey]; }
                        if (!ueditor && itemId && contextWindow && contextWindow.UE && contextWindow.UE.getEditor) { ueditor = contextWindow.UE.getEditor('ananas-editor-answer' + itemId); }
                        if (ueditor) { ueditor.setContent(answer); log('✅ 简答题答案已填写', 'green'); }
                        if (itemId) { $('#answer' + itemId).val(answer).trigger('change'); }
                    } catch(e) {}
                }, 300);
            });
            return true;
        }
        var $textarea = $question.find('textarea[name^="answer"], .answerTxt textarea');
        if ($textarea.length) { $textarea.val(answer); $textarea.trigger('input').trigger('change'); return true; }
        return false;
    }
    var $ueTextarea = $question.find('textarea[name^="answerEditor"], .eidtDiv textarea, .divText textarea');
    if ($ueTextarea.length) {
        var id = $ueTextarea.first().attr('id');
        if (id && UE && UE.getEditor && UE.getEditor(id)) {
            try { UE.getEditor(id).setContent(answer); return true; } catch(e) {}
        }
        $ueTextarea.val(answer);
        $ueTextarea.trigger('input').trigger('change');
        return true;
    }
    return false;
}
function waitForElement(selector, timeout) {
    timeout = timeout || 30000;
    return new Promise(function(resolve, reject) {
        var start = Date.now();
        var timer = setInterval(function() {
            if ($(selector).length) { clearInterval(timer); resolve(); }
            else if (Date.now() - start > timeout) { clearInterval(timer); reject(); }
        }, 500);
    });
}
function getElement(parent, selector, timeout) {
    timeout = timeout || 10000;
    return new Promise(function(resolve) {
        var result = parent.querySelector(selector);
        if (result) return resolve(result);
        var timer;
        var observer = new MutationObserver(function(mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var mutation = mutations[i];
                for (var j = 0; j < mutation.addedNodes.length; j++) {
                    var node = mutation.addedNodes[j];
                    if (node instanceof Element) {
                        result = node.matches(selector) ? node : node.querySelector(selector);
                        if (result) { observer.disconnect(); timer && clearTimeout(timer); return resolve(result); }
                    }
                }
            }
        });
        observer.observe(parent, { childList: true, subtree: true });
        timer = setTimeout(function() { observer.disconnect(); resolve(null); }, timeout);
    });
}
function getTaskParams() {
    try {
        var scripts = DOCUMENT.scripts;
        for (var i = 0; i < scripts.length; i++) {
            if (scripts[i].innerHTML.indexOf('mArg = "";') != -1 && scripts[i].innerHTML.indexOf('==UserScript==') == -1) {
                var params = extractString(scripts[i].innerHTML.replace(/\s/g, ""), 'try{mArg=', ';}catch');
                return params;
            }
        }
        return null;
    } catch(e) { return null; }
}
function isTaskCompleted(task) {
    if (!task) return false;
    if (task.isPassed === true) return true;
    if (task.status === 'completed' || task.status === 'finished') return true;
    if (task.finished === true) return true;
    return false;
}
function goToNext() {
    if (isJumping) return;
    isJumping = true;
    log('🔄 检查是否有下一章节...', 'blue');
    var nextBtn = null;
    try {
        nextBtn = top.document.querySelector('#mainid > .prev_next.next:not(.disabled)') || top.document.querySelector('#prevNextFocusNext:not(.disabled)') || top.document.querySelector('.prev_next.next:not(.disabled)') || $('.prev_next.next:not(.disabled)')[0];
        if (nextBtn && !nextBtn.disabled && !nextBtn.classList.contains('disabled')) {
            log('✅ 找到下一节按钮，3秒后跳转', 'green');
            setTimeout(function() { nextBtn.click(); log('📖 已点击跳转按钮', 'green'); isJumping = false; }, 3000);
            return true;
        } else { log('📚 课程已全部完成，无更多章节可跳转', 'green'); }
    } catch(e) { log('❌ 跳转失败: ' + e.message, 'red'); }
    isJumping = false;
    return false;
}
function completeCurrentTask() {
    if (taskList && taskList.length > 0) {
        var completedTask = taskList[0];
        var taskName = completedTask.property ? (completedTask.property.name || completedTask.property.title || '未知') : '未知';
        log('✅ 完成任务: ' + taskName, 'green');
        taskList.splice(0, 1);
        completedMissionCount++;
        log('📋 任务进度: ' + completedMissionCount + '/' + pendingMissionCount + ' | 剩余: ' + taskList.length, 'blue');
    }
    if (domList && domList.length > 0) { domList.splice(0, 1); }
    isProcessing = false;
    if (currentVideoInterval) { clearInterval(currentVideoInterval); currentVideoInterval = null; }
    if (currentVideoQuizObserver) { try { currentVideoQuizObserver.disconnect(); } catch(e) {} currentVideoQuizObserver = null; }
    stopQuizPoll();
    stopQuizObserverGuard();
    if (taskList && taskList.length > 0) {
        log('📋 还有 ' + taskList.length + ' 个任务点待处理，继续...', 'green');
        setTimeout(function() { startMission(); }, 2000);
    } else {
        log('✅ 此页面所有任务处理完毕', 'green');
        goToNext();
    }
}
function switchMission() {
    if (taskList.length <= 0) { log('✅ 此页面任务处理完毕', 'green'); isProcessing = false; goToNext(); return; }
    isProcessing = false;
    setTimeout(startMission, 3000);
}
function startMission() {
    if (isProcessing) return;
    if (taskList.length <= 0) { log('✅ 此页面任务处理完毕', 'green'); isProcessing = false; goToNext(); return; }
    isProcessing = true;
    var taskType = taskList[0]['type'];
    var dom = domList[0];
    var task = taskList[0];
    currentProcessingTask = task;
    if (taskType == undefined) { taskType = taskList[0]['property']["module"]; }
    var handlers = {
        'video': function() { processVideo(dom, task); },
        'audio': function() { processAudio(dom, task); },
        'workid': function() { processQuiz(dom, task); },
        'document': function() { processDocument(dom, task); },
        'read': function() { processRead(dom, task); },
        'insertbook': function() { processBook(dom, task); }
    };
    if (handlers[taskType]) { handlers[taskType](); }
    else if (['insertimage'].indexOf(taskType) !== -1) { log('ℹ️ 发现无需处理任务，跳过。', 'orange'); completeCurrentTask(); }
    else { log('⚠️ 暂不支持处理此类型:' + taskType + '，跳过。', 'red'); completeCurrentTask(); }
}

function processVideo(dom, obj) {
    if (!CONFIG.handleVideo) {
        log('ℹ️ 用户设置不处理视频任务', 'orange');
        completeCurrentTask();
        return;
    }
    var isPassed = obj.isPassed;
    var name = obj.property.name;
    if (!CONFIG.reviewMode && isPassed === true) {
        log('✅ 视频：' + name + ' 已完成，跳过', 'green');
        completeCurrentTask();
        return;
    }
    var target = dom.length > 0 ? dom[0] : null;
    if (!target) {
        log('⚠️ 未找到视频iframe，3秒后重试', 'orange');
        isProcessing = false;
        setTimeout(function() { processVideo(dom, obj); }, 3000);
        return;
    }
    log('🎬 处理视频：' + name, 'purple');
    var executed = false;
    var doc = target.contentDocument || target.contentWindow.document;
    if (currentVideoInterval) { clearInterval(currentVideoInterval); currentVideoInterval = null; }
    currentVideoInterval = setInterval(function() {
        var innerDoc = target.contentDocument || target.contentWindow.document;
        if (innerDoc && innerDoc.body && !currentVideoQuizObserver) {
            observeVideoQuiz(innerDoc);
            startQuizObserverGuard();
            startQuizPoll(innerDoc);
        }
        var media = innerDoc.querySelector('video') || innerDoc.querySelector('audio');
        if (media && !executed) {
            executed = true;
            log('✅ ' + name + ' 开始播放', 'green');
            media.pause();
            media.muted = true;
            media.playbackRate = CONFIG.videoRate > 1 ? Math.min(CONFIG.videoRate, 16) : 1;
            media.play();
            var resumePlay = function() {
                if (media.paused && !media.ended) {
                    setTimeout(function() {
                        var popup = innerDoc.querySelector('.ans-videoquiz, .TiMu, .videoquiz');
                        if (!popup && media.paused && !media.ended) {
                            media.play();
                            log('🔄 ' + name + ' 恢复播放', 'blue');
                        }
                    }, 3000);
                }
            };
            media.addEventListener('pause', resumePlay);
            var onVideoEnd = function() {
                log('✅ ' + name + ' 播放完成', 'green');
                media.removeEventListener('pause', resumePlay);
                media.removeEventListener('ended', onVideoEnd);
                if (currentVideoInterval) { clearInterval(currentVideoInterval); currentVideoInterval = null; }
                if (currentVideoQuizObserver) { try { currentVideoQuizObserver.disconnect(); } catch(e) {} currentVideoQuizObserver = null; }
                stopQuizPoll();
                stopQuizObserverGuard();
                completeCurrentTask();
            };
            media.addEventListener('ended', onVideoEnd);
            if (media.ended) { onVideoEnd(); }
        } else if (media && executed) {
            if (media.ended) {
                if (currentVideoInterval) { clearInterval(currentVideoInterval); currentVideoInterval = null; }
                if (currentVideoQuizObserver) { try { currentVideoQuizObserver.disconnect(); } catch(e) {} currentVideoQuizObserver = null; }
                stopQuizPoll();
                stopQuizObserverGuard();
                completeCurrentTask();
            }
        }
    }, 1500);
}
function processAudio(dom, obj) {
    if (!CONFIG.handleAudio) {
        log('ℹ️ 用户设置不处理音频任务', 'orange');
        completeCurrentTask();
        return;
    }
    var isPassed = obj.isPassed;
    var name = obj.property.name;
    if (!CONFIG.reviewMode && isPassed === true) {
        log('✅ 音频：' + name + ' 已完成，跳过', 'green');
        completeCurrentTask();
        return;
    }
    log('🎵 处理音频：' + name + '，等待5秒后完成', 'purple');
    setTimeout(function() { completeCurrentTask(); }, 5000);
}
function processBook(dom, obj) {
    var jobId = obj['property']['jobid'];
    var name = obj['property']['bookname'];
    var jtoken = obj['jtoken'];
    var knowledgeId = defaults['knowledgeid'];
    var courseId = defaults['courseid'];
    var clazzId = defaults['clazzId'];
    if (isTaskCompleted(obj)) {
        log('✅ 读书：' + name + ' 已完成，跳过', 'green');
        completeCurrentTask();
        return;
    }
    $.ajax({
        url: LOCATION.protocol + "//" + LOCATION.host + '/ananas/job?jobid=' + jobId + '&knowledgeid=' + knowledgeId + '&courseid=' + courseId + '&clazzid=' + clazzId + '&jtoken=' + jtoken + '&_dc=' + Date.now(),
        method: 'GET',
        success: function(res) { log('📚 读书：' + name + (res.msg || '完成'), 'green'); completeCurrentTask(); },
        error: function() {
            log('❌ 读书：' + name + ' 处理失败，3秒后重试', 'red');
            isProcessing = false;
            setTimeout(function() { processBook(dom, obj); }, 3000);
        }
    });
}
function processDocument(dom, obj) {
    var jobId = obj['property']['jobid'];
    var name = obj['property']['name'];
    var jtoken = obj['jtoken'];
    var knowledgeId = defaults['knowledgeid'];
    var courseId = defaults['courseid'];
    var clazzId = defaults['clazzId'];
    if (isTaskCompleted(obj)) {
        log('✅ 文档：' + name + ' 已完成，跳过', 'green');
        completeCurrentTask();
        return;
    }
    $.ajax({
        url: LOCATION.protocol + "//" + LOCATION.host + '/ananas/job/document?jobid=' + jobId + '&knowledgeid=' + knowledgeId + '&courseid=' + courseId + '&clazzid=' + clazzId + '&jtoken=' + jtoken + '&_dc=' + Date.now(),
        method: 'GET',
        success: function(res) { log('📄 文档：' + name + (res.msg || '完成'), 'green'); completeCurrentTask(); },
        error: function() {
            log('❌ 文档：' + name + ' 处理失败，3秒后重试', 'red');
            isProcessing = false;
            setTimeout(function() { processDocument(dom, obj); }, 3000);
        }
    });
}
function processRead(dom, obj) {
    var jobId = obj['property']['jobid'];
    var name = obj['property']['title'];
    var jtoken = obj['jtoken'];
    var knowledgeId = defaults['knowledgeid'];
    var courseId = defaults['courseid'];
    var clazzId = defaults['clazzId'];
    if (isTaskCompleted(obj)) {
        log('✅ 阅读：' + name + ' 已完成，跳过', 'green');
        completeCurrentTask();
        return;
    }
    $.ajax({
        url: LOCATION.protocol + '//' + LOCATION.host + '/ananas/job/readv2?jobid=' + jobId + '&knowledgeid=' + knowledgeId + '&courseid=' + courseId + '&clazzid=' + clazzId + '&jtoken=' + jtoken + '&_dc=' + Date.now(),
        method: 'GET',
        success: function(res) { log('📖 阅读：' + name + (res.msg || '完成'), 'green'); completeCurrentTask(); },
        error: function() {
            log('❌ 阅读：' + name + ' 处理失败，3秒后重试', 'red');
            isProcessing = false;
            setTimeout(function() { processRead(dom, obj); }, 3000);
        }
    });
}
function processQuiz(dom, obj) {
    if (!CONFIG.handleQuiz) {
        log('ℹ️ 用户设置不自动处理测验', 'orange');
        completeCurrentTask();
        return;
    }
    var isDo = true;
    if (CONFIG.taskOnly && obj['jobid'] == undefined) { isDo = false; }
    if (isDo) {
        if (obj['jobid'] !== undefined) {
            var phoneWeb = LOCATION.protocol + '//' + LOCATION.host + '/work/phone/work?workId=' + obj['jobid'].replace('work-', '') + '&courseId=' + defaults['courseid'] + '&clazzId=' + defaults['clazzId'] + '&knowledgeId=' + defaults['knowledgeid'] + '&jobId=' + obj['jobid'] + '&enc=' + obj['enc'];
            log('📝 准备处理测验', 'purple');
            setTimeout(function() { startPhoneQuiz(0, dom, phoneWeb, obj); }, 3000);
        } else {
            setTimeout(function() { startPCQuiz(0, dom, obj); }, 3000);
        }
    } else {
        log('ℹ️ 用户设置只处理属于任务点的任务', 'orange');
        completeCurrentTask();
    }
}
function startPhoneQuiz(index, doms, phoneWeb, taskObj) {
    if (index == doms.length) { log('✅ 此页面全部测验已处理完毕', 'green'); completeCurrentTask(); return; }
    getElement($(doms[index]).contents()[0], 'iframe').then(function(iframe) {
        if (!iframe) { setTimeout(function() { startPhoneQuiz(index, doms, phoneWeb, taskObj); }, 5000); return; }
        var workIframe = $(iframe);
        var workStatus = workIframe.contents().find('.newTestCon .newTestTitle .testTit_status').text().trim();
        if (!workStatus) { domList.splice(0, 1); isProcessing = false; setTimeout(switchMission, 2000); return; }
        if (workStatus.indexOf("待做") != -1 || workStatus.indexOf("待完成") != -1 || workStatus.indexOf("未达到及格线") != -1) {
            workIframe.attr('src', phoneWeb);
            getElement($(doms[index]).contents()[0], 'iframe[src="' + phoneWeb + '"]').then(function() {
                setTimeout(function() { doPhoneQuiz(workIframe.contents(), taskObj); }, 3000);
            });
        } else if (workStatus.indexOf('待批阅') != -1) {
            taskList.splice(0, 1); domList.splice(0, 1);
            log('⚠️ 测验待批阅,跳过', 'red');
            completeCurrentTask();
        } else if (workStatus.indexOf('已完成') != -1 || workStatus.indexOf('已交') != -1) {
            log('✅ 测验已完成，跳过', 'green');
            completeCurrentTask();
        } else {
            taskList.splice(0, 1); domList.splice(0, 1);
            log('⚠️ 未知状态,跳过', 'red');
            completeCurrentTask();
        }
    });
}
function doPhoneQuiz($dom, taskObj) {
    var $cy = $dom.find('.Wrappadding form');
    submitBtn = $cy.find('.zquestions .zsubmit .btn-ok-bottom');
    okBtn = $dom.find('#okBtn');
    saveBtn = $cy.find('.zquestions .zsubmit .btn-save');
    var questionList = $cy.find('.zquestions .Py-mian1');
    processPhoneQuestions(0, questionList, taskObj);
}
function processPhoneQuestions(index, questionList, taskObj) {
    if (index == questionList.length) {
        var decision = getSubmitDecision();
        if (decision.action === 'submit') {
            log('✅ 测验处理完成，准备' + decision.reason + '。', 'green');
            setTimeout(function() {
                submitBtn.click();
                setTimeout(function() { okBtn.click(); log('✅ 提交成功', 'green'); completeCurrentTask(); }, 3000);
            }, 5000);
        } else {
            log('💾 ' + decision.reason + '，自动保存', 'green');
            setTimeout(function() {
                saveBtn.click();
                setTimeout(function() { log('✅ 保存成功', 'green'); completeCurrentTask(); }, 3000);
            }, 5000);
        }
        return;
    }
    var contextWindow = questionList[index] ? (questionList[index].ownerDocument.defaultView || unsafeWindow) : unsafeWindow;
    var $question = $(questionList[index]);
    var questionHtml = $question.find('.Py-m1-title').html() || $question.html() || '';
    var typeName = '';
    var bracketMatch = questionHtml.match(/\[(.*?)\]/);
    var _hash = atob('YW13eGI=');
    if (bracketMatch && bracketMatch[1]) { typeName = bracketMatch[1]; }
    if (!typeName) { var chineseMatch = questionHtml.match(/(单选题|多选题|填空题|判断题|简答题)/); if (chineseMatch) { typeName = chineseMatch[1]; } }
    var typeMap = { '单选题': 0, '多选题': 1, '填空题': 2, '判断题': 3, '简答题': 4 };
    var questionType = typeMap[typeName];
    if (questionType === undefined) { questionType = getQuestionTypeFromText(questionHtml); }
    if (questionType === undefined) {
        if ($question.find('.answerList.singleChoice li').length) questionType = 0;
        else if ($question.find('.answerList.multiChoice li').length) questionType = 1;
        else if ($question.find('.blankList2 input').length) questionType = 2;
        else if ($question.find('.answerList.panduan li').length) questionType = 3;
        else if ($question.find('textarea').length) questionType = 4;
    }
    if (questionType === undefined) {
        log('⚠️ 第' + (index + 1) + '题无法识别题型，跳过', 'orange');
        setTimeout(function() { processPhoneQuestions(index + 1, questionList, taskObj); }, getRandomInterval());
        return;
    }
    var cleanedQuestion = tidyQuestion(questionHtml);
    cleanedQuestion = cleanedQuestion.replace(/\[.*?\]/, '').trim();
    cleanedQuestion = cleanedQuestion.replace(/^\d+[.、]?\s*/, '');
    var checkAnswered = function() {
        if (questionType == 0 || questionType == 1) {
            var $opts = questionType == 0 ? $question.find('.answerList.singleChoice li') : $question.find('.answerList.multiChoice li');
            for (var i = 0; i < $opts.length; i++) { if ($($opts[i]).attr('aria-label')) return true; }
        } else if (questionType == 2) {
            var $inputs = $question.find('.blankList2 input');
            if ($inputs.length && $inputs.first().val() && $inputs.first().val().trim() !== '') return true;
            var $editorBlocks = $question.find('[data-editorindex]');
            if ($editorBlocks.length) {
                var hasContent = false;
                $editorBlocks.each(function() { var itemId = $(this).attr('data-itemid'); if (itemId && $('#answer' + itemId).val() && $('#answer' + itemId).val().trim() !== '') { hasContent = true; } });
                if (hasContent) return true;
            }
        } else if (questionType == 3) {
            var $pd = $question.find('.answerList.panduan li');
            for (var i = 0; i < $pd.length; i++) { if ($($pd[i]).attr('aria-label')) return true; }
        } else if (questionType == 4) {
            var $ta = $question.find('textarea[name^="answer"]');
            if ($ta.length && $ta.first().val() && $ta.first().val().trim() !== '') return true;
            var $editorBlocks = $question.find('[data-editorindex]');
            if ($editorBlocks.length) {
                var hasContent = false;
                $editorBlocks.each(function() { var itemId = $(this).attr('data-itemid'); if (itemId && $('#answer' + itemId).val() && $('#answer' + itemId).val().trim() !== '') { hasContent = true; } });
                if (hasContent) return true;
            }
        }
        return false;
    };
    if (checkAnswered()) {
        log('📌 第' + (index + 1) + '题已作答，跳过', 'green');
        setTimeout(function() { processPhoneQuestions(index + 1, questionList, taskObj); }, 30);
        return;
    }
    var $opts = [];
    var optsText = [];
    var optionsData = [];
    var pureQuestion = cleanedQuestion;
    if (questionType == 0 || questionType == 1) {
        $opts = questionType == 0 ? $question.find('.answerList.singleChoice li') : $question.find('.answerList.multiChoice li');
        $opts.each(function() {
            var rawText = tidyString($(this).html());
            rawText = rawText.replace(/^[A-Z][\s]*[.、．）)\s]+/, '');
            rawText = rawText.replace(/^\([A-Z]\)[\s]*/, '');
            rawText = rawText.replace(/^（[A-Z]）[\s]*/, '');
            optsText.push(rawText);
        });
        optionsData = optsText;
    } else if (questionType == 2) {
        var blankCount = getBlankCount($question);
        optionsData = [blankCount.toString()];
        log('📝 填空题传入空数量: ' + blankCount, 'blue');
    } else if (questionType == 3) {
        optionsData = ["对", "错"];
    } else if (questionType == 4) {
        optionsData = ["1"];
    }
    getAnswer(questionType, pureQuestion, optionsData).then(function(answer) {
        if (answer == '暂无答案' || !answer) {
            log('⚠️ 第' + (index + 1) + '题无法获取答案，跳过', 'red');
            setTimeout(function() { processPhoneQuestions(index + 1, questionList, taskObj); }, getRandomInterval());
            return;
        }
        if (CONFIG.insertAnswer) { $question.find('.Py-m1-title').html($question.find('.Py-m1-title').html() + '<p style="color:green;">📖 ' + answer + '</p>'); }
        if (questionType == 0) {
            var normalizedOpts = optsText.map(function(opt) { return normalizeForCompare(opt); });
            var normalizedAnswer = normalizeForCompare(answer);
            var idx = normalizedOpts.findIndex(function(t) { return t === normalizedAnswer; });
            if (idx === -1) { idx = normalizedOpts.findIndex(function(t) { return t.indexOf(normalizedAnswer) !== -1 || normalizedAnswer.indexOf(t) !== -1; }); }
            if (idx != -1) { $question.find('.answerList.singleChoice li').eq(idx).click(); log('✅ 单选题已选: ' + optsText[idx], 'green'); }
            else { log('⚠️ 未找到匹配选项: ' + answer, 'orange'); }
        } else if (questionType == 1) {
            var hitIdx = matchMultiChoiceIndices(optsText, answer);
            if (hitIdx.length > 0) {
                hitIdx.forEach(function(i, k) {
                    setTimeout(function() { $($opts[i]).click(); }, 300 * (k + 1));
                });
                log('✅ 多选题已选 ' + hitIdx.length + ' 项: ' + hitIdx.map(function(i){return optsText[i];}).join(' | '), 'green');
            } else {
                log('⚠️ 多选题未匹配到任何选项，答案: ' + answer, 'orange');
            }
        } else if (questionType == 2) {
            fillBlankAnswer($question, answer, true, contextWindow);
        } else if (questionType == 3) {
            var trueKeywords = '正确|是|对|√|T|ri';
            var $pd = $question.find('.answerList.panduan li');
            if (answer && answer.trim() !== '' && (trueKeywords.indexOf(answer) != -1 || trueKeywords.toLowerCase().indexOf(answer.toLowerCase()) != -1)) {
                $pd.each(function(i, t) { if ($(t).attr('val-param') == 'true') { $(t).click(); log('✅ 判断题自动选择: 正确 (接口返回: ' + answer + ')', 'green'); } });
            } else {
                $pd.each(function(i, t) { if ($(t).attr('val-param') == 'false') { $(t).click(); log('✅ 判断题自动选择: 错误 (接口返回: ' + answer + ')', 'green'); } });
            }
        } else if (questionType == 4) {
            fillShortAnswer($question, answer, true, contextWindow);
        }
        log('✅ 第' + (index + 1) + '题自动答题成功', 'green');
        setTimeout(function() { processPhoneQuestions(index + 1, questionList, taskObj); }, getRandomInterval());
    }).catch(function(err) {
        log('⚠️ 第' + (index + 1) + '题获取答案失败: ' + err, 'orange');
        setTimeout(function() { processPhoneQuestions(index + 1, questionList, taskObj); }, getRandomInterval());
    });
}
function startPCQuiz(index, doms, taskObj) {
    if (index == doms.length) { log('✅ 此页面全部测验已处理完毕', 'green'); completeCurrentTask(); return; }
    getElement($(doms[index]).contents()[0], 'iframe').then(function(iframe) {
        if (!iframe) { setTimeout(function() { startPCQuiz(index, doms, taskObj); }, 5000); return; }
        var workIframe = $(iframe);
        var workStatus = workIframe.contents().find(".newTestCon .newTestTitle .testTit_status").text().trim();
        if (!workStatus) { domList.splice(0, 1); isProcessing = false; setTimeout(switchMission, 2000); return; }
        if (workStatus.indexOf("待做") != -1 || workStatus.indexOf("待完成") != -1) {
            log('📝 准备处理测验', 'purple');
            setTimeout(function() { doPCQuiz(index, doms, iframe, taskObj); }, 5000);
        } else if (workStatus.indexOf('待批阅') != -1) {
            taskList.splice(0, 1); domList.splice(0, 1);
            log('⚠️ 测验待批阅,跳过', 'red');
            completeCurrentTask();
        } else if (workStatus.indexOf('已完成') != -1 || workStatus.indexOf('已交') != -1) {
            log('✅ 测验已完成，跳过', 'green');
            completeCurrentTask();
        } else {
            taskList.splice(0, 1); domList.splice(0, 1);
            log('⚠️ 未知状态,跳过', 'red');
            completeCurrentTask();
        }
    });
}
function doPCQuiz(index, doms, dom, taskObj) {
    frameContent = $(dom).contents();
    var $cyHtml = frameContent.find('.CeYan');
    var questionList = $cyHtml.find('.TiMu');
    submitBtn = frameContent.find(".ZY_sub").find(".btnSubmit");
    saveBtn = frameContent.find(".ZY_sub").find(".btnSave");
    processPCQuestions(index, doms, 0, questionList, taskObj);
}
function processPCQuestions(index, doms, qIndex, questionList, taskObj) {
    if (qIndex == questionList.length) {
        var decision = getSubmitDecision();
        if (decision.action === 'submit') {
            log('✅ 测验处理完成，准备' + decision.reason + '。', 'green');
            setTimeout(function() {
                submitBtn.click();
                setTimeout(function() { frameContent.find('#confirmSubWin > div > div > a.bluebtn').click(); log('✅ 提交成功', 'green'); completeCurrentTask(); }, 3000);
            }, 5000);
        } else {
            log('💾 ' + decision.reason + '，自动保存', 'green');
            setTimeout(function() {
                saveBtn.click();
                setTimeout(function() { log('✅ 保存成功', 'green'); completeCurrentTask(); }, 3000);
            }, 5000);
        }
        return;
    }
    var $question = $(questionList[qIndex]);
    var questionHtml = $question.find('.Zy_TItle.clearfix > div').html() || $question.html() || '';
    var typeName = '';
    var bracketMatch = questionHtml.match(/【(.*?)】/);
    if (bracketMatch && bracketMatch[1]) { typeName = bracketMatch[1]; }
    if (!typeName) { var chineseMatch = questionHtml.match(/(单选题|多选题|填空题|判断题|简答题)/); if (chineseMatch) { typeName = chineseMatch[1]; } }
    var typeMap = { '单选题': 0, '多选题': 1, '填空题': 2, '判断题': 3, '简答题': 4 };
    var questionType = typeMap[typeName];
    if (questionType === undefined) { questionType = getQuestionTypeFromText(questionHtml); }
    if (questionType === undefined) {
        if ($question.find('.Zy_ulTop li').length) { questionType = $question.find('input[type="checkbox"]').length ? 1 : 0; }
        else if ($question.find('.Zy_ulTk .XztiHover1').length) { questionType = 2; }
        else { questionType = 4; }
    }
    var cleanedQuestion = tidyQuestion(questionHtml);
    cleanedQuestion = cleanedQuestion.replace(/【.*?】/, '').trim();
    cleanedQuestion = cleanedQuestion.replace(/^\d+[.、]?\s*/, '');
    var $opts = [];
    var optsText = [];
    var optionsData = [];
    var pureQuestion = cleanedQuestion;
    if (questionType == 0 || questionType == 1) {
        $opts = $question.find('.Zy_ulTop li a');
        $opts.each(function() {
            var rawText = tidyString($(this).html());
            rawText = rawText.replace(/^[A-Z][\s]*[.、．）)\s]+/, '');
            rawText = rawText.replace(/^\([A-Z]\)[\s]*/, '');
            rawText = rawText.replace(/^（[A-Z]）[\s]*/, '');
            optsText.push(rawText);
        });
        optionsData = optsText;
    } else if (questionType == 2) {
        var blankCount = getBlankCount($question);
        optionsData = [blankCount.toString()];
    } else if (questionType == 3) {
        optionsData = ["对", "错"];
    } else if (questionType == 4) {
        optionsData = ["1"];
    }
    getAnswer(questionType, pureQuestion, optionsData).then(function(answer) {
        if (answer && answer != '暂无答案') {
            if (CONFIG.insertAnswer) { $question.find('.Zy_TItle.clearfix > div').html($question.find('.Zy_TItle.clearfix > div').html() + '<p style="color:green;">📖 ' + answer + '</p>'); }
            if (questionType == 0) {
                var normalizedOpts = optsText.map(function(opt) { return normalizeForCompare(opt); });
                var normalizedAnswer = normalizeForCompare(answer);
                var idx = normalizedOpts.findIndex(function(t) { return t === normalizedAnswer; });
                if (idx === -1) { idx = normalizedOpts.findIndex(function(t) { return t.indexOf(normalizedAnswer) !== -1 || normalizedAnswer.indexOf(t) !== -1; }); }
                if (idx != -1) { $($opts[idx]).parent().click(); log('✅ PC单选题已选: ' + optsText[idx], 'green'); }
                else { log('⚠️ 未找到匹配选项: ' + answer, 'orange'); }
            } else if (questionType == 1) {
                var hitIdx = matchMultiChoiceIndices(optsText, answer);
                if (hitIdx.length > 0) {
                    hitIdx.forEach(function(i, k) {
                        setTimeout(function() { $($opts[i]).parent().click(); }, 300 * (k + 1));
                    });
                    log('✅ PC多选题已选 ' + hitIdx.length + ' 项: ' + hitIdx.map(function(i){return optsText[i];}).join(' | '), 'green');
                } else {
                    log('⚠️ PC多选题未匹配到任何选项，答案: ' + answer, 'orange');
                }
            } else if (questionType == 2) {
                fillBlankAnswer($question, answer, false, null);
            } else if (questionType == 3) {
                var trueKeywords = '正确|是|对|√|T|ri';
                var $pdContainer = $question.find('.Zy_ulTop li');
                if ($pdContainer.length === 0) { $pdContainer = $question.find('.stem_answer .answer_p').parent(); }
                if (answer && answer.trim() !== '' && (trueKeywords.indexOf(answer) != -1 || trueKeywords.toLowerCase().indexOf(answer.toLowerCase()) != -1)) {
                    var clicked = false;
                    $pdContainer.each(function(i, t) {
                        var $opt = $(t).find('a, .answer_p');
                        if ($opt.length === 0) $opt = $(t);
                        var valAttr = $(t).find('span').attr('val-param') || $(t).attr('val-param');
                        if (valAttr == 'true') { $(t).click(); clicked = true; log('✅ PC判断题自动选择: 正确 (接口返回: ' + answer + ')', 'green'); }
                    });
                    if (!clicked && $pdContainer.length > 0) { $($pdContainer[0]).click(); log('✅ PC判断题自动选择: 正确(默认第一个) (接口返回: ' + answer + ')', 'green'); }
                } else {
                    var clicked = false;
                    $pdContainer.each(function(i, t) {
                        var valAttr = $(t).find('span').attr('val-param') || $(t).attr('val-param');
                        if (valAttr == 'false') { $(t).click(); clicked = true; log('✅ PC判断题自动选择: 错误 (接口返回: ' + answer + ')', 'green'); }
                    });
                    if (!clicked && $pdContainer.length > 1) { $($pdContainer[1]).click(); log('✅ PC判断题自动选择: 错误(默认第二个) (接口返回: ' + answer + ')', 'green'); }
                    else if (!clicked && $pdContainer.length === 1) { $($pdContainer[0]).click(); log('✅ PC判断题自动选择: 错误(唯一选项) (接口返回: ' + answer + ')', 'green'); }
                }
            } else if (questionType == 4) {
                fillShortAnswer($question, answer, false, null);
            }
            log('✅ PC第' + (qIndex + 1) + '题自动答题成功', 'green');
        } else {
            log('⚠️ PC第' + (qIndex + 1) + '题无法获取答案', 'orange');
        }
        setTimeout(function() { processPCQuestions(index, doms, qIndex + 1, questionList, taskObj); }, getRandomInterval());
    }).catch(function() {
        setTimeout(function() { processPCQuestions(index, doms, qIndex + 1, questionList, taskObj); }, getRandomInterval());
    });
}
function processHomework() {
    log('📝 开始处理作业', 'green');
    var $homeworkTable = $('.mark_table').find('form');
    var questionList = $homeworkTable.find('.questionLi');
    doHomework(0, questionList);
}
function doHomework(index, questionList) {
    if (index == questionList.length) { log('✅ 作业题目已全部完成', 'green'); return; }
    var $question = $(questionList[index]);
    var typeName = $question.attr('typename');
    var typeMap = { '单选题': 0, '多选题': 1, '填空题': 2, '判断题': 3, '简答题': 4 };
    var questionType = typeMap[typeName];
    var questionFull = $question.find('.mark_name').html() || '';
    var cleanedQuestion = tidyQuestion(questionFull);
    cleanedQuestion = cleanedQuestion.replace(/^[(].*?[)]/, '').trim();
    cleanedQuestion = cleanedQuestion.replace(/^\d+[.、]?\s*/, '');
    if (questionType === undefined) { questionType = getQuestionTypeFromText(questionFull); }
    if (questionType === undefined) {
        var answerTmpArr = $question.find('.stem_answer').find('.answer_p');
        if (answerTmpArr && answerTmpArr.length > 0) { questionType = $question.find('input[type="checkbox"]').length ? 1 : 0; }
        else if ($question.find('.stem_answer').find('.divText textarea').length) { questionType = 4; }
    }
    if (questionType === undefined) {
        log('⚠️ 作业第' + (index + 1) + '题无法识别题型，跳过', 'orange');
        setTimeout(function() { doHomework(index + 1, questionList); }, getRandomInterval());
        return;
    }
    var checkAnswered = function() {
        if (questionType == 0 || questionType == 1) {
            var $opts = $question.find('.stem_answer .answer_p');
            for (var i = 0; i < $opts.length; i++) { if ($($opts[i]).parent().find('span').attr('class') && $($opts[i]).parent().find('span').attr('class').indexOf('check_answer') != -1) { return true; } }
        } else if (questionType == 2) {
            var $inputs = $question.find('.stem_answer .Answer .divText .textDIV textarea');
            if ($inputs.length && $inputs.val() && $inputs.val().trim() !== '') return true;
        } else if (questionType == 3) {
            var $opts = $question.find('.stem_answer .answer_p');
            for (var i = 0; i < $opts.length; i++) { if ($($opts[i]).parent().find('span').attr('class') && $($opts[i]).parent().find('span').attr('class').indexOf('check_answer') != -1) { return true; } }
        } else if (questionType == 4) {
            var $ta = $question.find('.stem_answer .eidtDiv textarea');
            if ($ta.length && $ta.val() && $ta.val().trim() !== '') return true;
        }
        return false;
    };
    if (checkAnswered()) {
        log('📌 作业第' + (index + 1) + '题已作答，跳过', 'green');
        setTimeout(function() { doHomework(index + 1, questionList); }, 30);
        return;
    }
    var $opts = [];
    var optsText = [];
    var optionsData = [];
    var pureQuestion = cleanedQuestion;
    if (questionType == 0 || questionType == 1) {
        $opts = $question.find('.stem_answer .answer_p');
        $opts.each(function() {
            var rawText = tidyString($(this).html());
            rawText = rawText.replace(/^[A-Z][\s]*[.、．）)\s]+/, '');
            rawText = rawText.replace(/^\([A-Z]\)[\s]*/, '');
            rawText = rawText.replace(/^（[A-Z]）[\s]*/, '');
            optsText.push(rawText);
        });
        optionsData = optsText;
    } else if (questionType == 2) {
        var blankCount = getBlankCount($question);
        optionsData = [blankCount.toString()];
    } else if (questionType == 3) {
        optionsData = ["对", "错"];
    } else if (questionType == 4) {
        optionsData = ["1"];
    }
    getAnswer(questionType, pureQuestion, optionsData).then(function(answer) {
        if (answer && answer != '暂无答案') {
            if (CONFIG.insertAnswer) { $question.find('.mark_name').html($question.find('.mark_name').html() + '<p style="color:green;">📖 ' + answer + '</p>'); }
            if (questionType == 0) {
                var normalizedOpts = optsText.map(function(opt) { return normalizeForCompare(opt); });
                var normalizedAnswer = normalizeForCompare(answer);
                var idx = normalizedOpts.findIndex(function(t) { return t === normalizedAnswer; });
                if (idx === -1) { idx = normalizedOpts.findIndex(function(t) { return t.indexOf(normalizedAnswer) !== -1 || normalizedAnswer.indexOf(t) !== -1; }); }
                if (idx != -1) { $($opts[idx]).parent().click(); log('✅ 作业单选题已选: ' + optsText[idx], 'green'); }
                else { log('⚠️ 未找到匹配选项: ' + answer, 'orange'); }
            } else if (questionType == 1) {
                var hitIdx = matchMultiChoiceIndices(optsText, answer);
                if (hitIdx.length > 0) {
                    hitIdx.forEach(function(i, k) {
                        setTimeout(function() { $($opts[i]).parent().click(); }, 300 * (k + 1));
                    });
                    log('✅ 作业多选题已选 ' + hitIdx.length + ' 项: ' + hitIdx.map(function(i){return optsText[i];}).join(' | '), 'green');
                } else {
                    log('⚠️ 作业多选题未匹配到任何选项，答案: ' + answer, 'orange');
                }
            } else if (questionType == 2) {
                fillBlankAnswer($question, answer, false, null);
            } else if (questionType == 3) {
                var trueKeywords = '正确|是|对|√|T|ri';
                var $pdContainer = $question.find('.stem_answer .answer_p').parent();
                if (answer && answer.trim() !== '' && (trueKeywords.indexOf(answer) != -1 || trueKeywords.toLowerCase().indexOf(answer.toLowerCase()) != -1)) {
                    if ($pdContainer.length > 0) { $($pdContainer[0]).click(); log('✅ 作业判断题自动选择: 正确 (接口返回: ' + answer + ')', 'green'); }
                } else {
                    if ($pdContainer.length > 1) { $($pdContainer[1]).click(); log('✅ 作业判断题自动选择: 错误 (接口返回: ' + answer + ')', 'green'); }
                    else if ($pdContainer.length === 1) { $($pdContainer[0]).click(); log('✅ 作业判断题自动选择: 错误(唯一选项) (接口返回: ' + answer + ')', 'green'); }
                }
            } else if (questionType == 4) {
                fillShortAnswer($question, answer, false, null);
            }
            log('✅ 作业第' + (index + 1) + '题自动答题成功', 'green');
        } else {
            log('⚠️ 作业第' + (index + 1) + '题无法获取答案', 'orange');
        }
        setTimeout(function() { doHomework(index + 1, questionList); }, getRandomInterval());
    }).catch(function() {
        setTimeout(function() { doHomework(index + 1, questionList); }, getRandomInterval());
    });
}
function processExam() {
    var $examTable = $('.mark_table').find('.whiteDiv');
    var questionFull = tidyString($examTable.find('h3.mark_name').html().trim());
    var typeName = questionFull.match(/[(](.*?),.*?分[)]|$/)[1];
    var typeMap = { '单选题': 0, '多选题': 1, '填空题': 2, '判断题': 3, '简答题': 4 };
    var questionType = typeMap[typeName];
    var cleanedQuestion = tidyQuestion(questionFull.replace(/[(].*?分[)]/, '').replace(/^\s*/, ''));
    cleanedQuestion = cleanedQuestion.replace(/^\d+[.、]?\s*/, '');
    var $answerDom = $examTable.find('#submitTest').find('.stem_answer');
    if (questionType === undefined) { questionType = getQuestionTypeFromText(questionFull); }
    if (questionType === undefined) {
        var $opts = $answerDom.find('.clearfix.answerBg .fl.answer_p');
        if ($opts.length) { questionType = $answerDom.find('input[type="checkbox"]').length ? 1 : 0; }
        else if ($answerDom.find('.Answer .divText .subEditor textarea').length) { questionType = 4; }
    }
    if (questionType === undefined) {
        log('⚠️ 考试题目无法识别题型，跳过', 'orange');
        goToNextExam();
        return;
    }
    var checkAnswered = function() {
        if (questionType == 0 || questionType == 1) {
            var $opts = $answerDom.find('.clearfix.answerBg .fl.answer_p');
            for (var i = 0; i < $opts.length; i++) { if ($($opts[i]).parent().find('span').attr('class') && $($opts[i]).parent().find('span').attr('class').indexOf('check_answer') != -1) { return true; } }
        } else if (questionType == 2) {
            var $inputs = $answerDom.find('.Answer .divText .subEditor textarea');
            if ($inputs.length && $inputs.val() && $inputs.val().trim() !== '') return true;
        } else if (questionType == 4) {
            var $ta = $answerDom.find('.subEditor textarea');
            if ($ta.length && $ta.val() && $ta.val().trim() !== '') return true;
        }
        return false;
    };
    if (checkAnswered()) {
        log('📌 考试此题已作答，跳过', 'green');
        goToNextExam();
        return;
    }
    var $opts = [];
    var optsText = [];
    var optionsData = [];
    var pureQuestion = cleanedQuestion;
    if (questionType == 0 || questionType == 1) {
        $opts = $answerDom.find('.clearfix.answerBg .fl.answer_p');
        $opts.each(function() {
            var rawText = tidyString($(this).html());
            rawText = rawText.replace(/^[A-Z][\s]*[.、．）)\s]+/, '');
            rawText = rawText.replace(/^\([A-Z]\)[\s]*/, '');
            rawText = rawText.replace(/^（[A-Z]）[\s]*/, '');
            optsText.push(rawText);
        });
        optionsData = optsText;
    } else if (questionType == 2) {
        var blankCount = getBlankCount($answerDom);
        optionsData = [blankCount.toString()];
    } else if (questionType == 4) {
        optionsData = ["1"];
    } else if (questionType == 3) {
        optionsData = ["对", "错"];
    }
    getAnswer(questionType, pureQuestion, optionsData).then(function(answer) {
        if (answer && answer != '暂无答案') {
            if (CONFIG.insertAnswer) { $examTable.find('h3.mark_name').html($examTable.find('h3.mark_name').html() + '<span style="color:green;">📖 ' + answer + '</span>'); }
            if (questionType == 0) {
                var normalizedOpts = optsText.map(function(opt) { return normalizeForCompare(opt); });
                var normalizedAnswer = normalizeForCompare(answer);
                var idx = normalizedOpts.findIndex(function(t) { return t === normalizedAnswer; });
                if (idx === -1) { idx = normalizedOpts.findIndex(function(t) { return t.indexOf(normalizedAnswer) !== -1 || normalizedAnswer.indexOf(t) !== -1; }); }
                if (idx != -1) { $($opts[idx]).parent().click(); log('✅ 考试单选题已选: ' + optsText[idx], 'green'); }
                else { log('⚠️ 未找到匹配选项: ' + answer, 'orange'); }
            } else if (questionType == 1) {
                var hitIdx = matchMultiChoiceIndices(optsText, answer);
                if (hitIdx.length > 0) {
                    hitIdx.forEach(function(i, k) {
                        setTimeout(function() { $($opts[i]).parent().click(); }, 300 * (k + 1));
                    });
                    log('✅ 考试多选题已选 ' + hitIdx.length + ' 项: ' + hitIdx.map(function(i){return optsText[i];}).join(' | '), 'green');
                } else {
                    log('⚠️ 考试多选题未匹配到任何选项，答案: ' + answer, 'orange');
                }
            } else if (questionType == 2) {
                fillBlankAnswer($answerDom, answer, false, null);
            } else if (questionType == 3) {
                var trueKeywords = '正确|是|对|√|T|ri';
                var $pdContainer = $answerDom.find('.clearfix.answerBg .fl.answer_p').parent();
                if (answer && answer.trim() !== '' && (trueKeywords.indexOf(answer) != -1 || trueKeywords.toLowerCase().indexOf(answer.toLowerCase()) != -1)) {
                    if ($pdContainer.length > 0) { $($pdContainer[0]).click(); log('✅ 考试判断题自动选择: 正确 (接口返回: ' + answer + ')', 'green'); }
                } else {
                    if ($pdContainer.length > 1) { $($pdContainer[1]).click(); log('✅ 考试判断题自动选择: 错误 (接口返回: ' + answer + ')', 'green'); }
                    else if ($pdContainer.length === 1) { $($pdContainer[0]).click(); log('✅ 考试判断题自动选择: 错误(唯一选项) (接口返回: ' + answer + ')', 'green'); }
                }
            } else if (questionType == 4) {
                fillShortAnswer($answerDom, answer, false, null);
            }
            log('✅ 考试自动答题成功', 'green');
        } else {
            log('⚠️ 考试无法获取答案', 'orange');
        }
        setTimeout(function() { goToNextExam(); }, getRandomInterval());
    }).catch(function() {
        setTimeout(function() { goToNextExam(); }, getRandomInterval());
    });
}
function goToNextExam() {
    if (CONFIG.autoNextExam) {
        var $nextBtn = $('.mark_table .whiteDiv .nextDiv a.jb_btn');
        var delay = CONFIG.examNextDelay ? 2000 + (Math.floor(Math.random() * 5 + 1) * 1000) : 2000;
        setTimeout(function() { $nextBtn.click(); }, delay);
        log('⏭️ ' + (delay/1000) + '秒后自动跳转下一题', 'blue');
    }
}
function decryptFont() {
    var TyprInstance = null;
    var md5Instance = null;
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow.Typr) { TyprInstance = unsafeWindow.Typr; }
    else if (typeof window !== 'undefined' && window.Typr) { TyprInstance = window.Typr; }
    else if (typeof Typr !== 'undefined') { TyprInstance = Typr; }
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow.md5) { md5Instance = unsafeWindow.md5; }
    else if (typeof window !== 'undefined' && window.md5) { md5Instance = window.md5; }
    else if (typeof md5 !== 'undefined') { md5Instance = md5; }
    if (!TyprInstance || !md5Instance || !TyprInstance.U) { setTimeout(function() { decryptFont(); }, 1000); return; }
    var $tip = $('style:contains(font-cxsecret)');
    if (!$tip.length) return;
    try {
        var styleText = $tip.text();
        var fontBase64 = null;
        var match1 = styleText.match(/base64,([\w\W]+?)'/);
        if (match1 && match1[1]) fontBase64 = match1[1];
        if (!fontBase64) {
            var match2 = styleText.match(/url\("data:application\/font-woff;charset=utf-8;base64,([\w\W]+?)"\)/);
            if (match2 && match2[1]) fontBase64 = match2[1];
        }
        if (!fontBase64) {
            var match3 = styleText.match(/url\('data:application\/font-woff;charset=utf-8;base64,([\w\W]+?)'\)/);
            if (match3 && match3[1]) fontBase64 = match3[1];
        }
        if (!fontBase64) return;
        var fontUint8Array = base64ToUint8Array(fontBase64);
        var parsedFont = TyprInstance.parse(fontUint8Array);
        if (!parsedFont || parsedFont.length === 0) return;
        var font = parsedFont[0];
        var tableJson = GM_getResourceText('Table');
        if (!tableJson) return;
        var table;
        try { table = JSON.parse(tableJson); } catch(e) { return; }
        var $secretElements = $('.font-cxsecret');
        if ($secretElements.length === 0) return;
        var existingChars = new Set();
        $secretElements.each(function() {
            var html = $(this).html();
            if (html) { for (var j = 0; j < html.length; j++) { existingChars.add(html.charCodeAt(j)); } }
        });
        if (existingChars.size === 0) return;
        var match = {};
        var charCodes = Array.from(existingChars);
        log('🔓 发现 ' + charCodes.length + ' 个加密字符，开始解密...', 'blue');
        for (var idx = 0; idx < charCodes.length; idx++) {
            var i = charCodes[idx];
            var glyph = TyprInstance.U.codeToGlyph(font, i);
            if (!glyph) continue;
            var path = TyprInstance.U.glyphToPath(font, glyph);
            if (!path) continue;
            var pathStr = JSON.stringify(path);
            var hash = md5Instance(pathStr);
            if (!hash) continue;
            var hashKey = hash.slice(24);
            var realChar = table[hashKey];
            if (realChar !== undefined && realChar !== null && realChar !== 0) { match[i] = realChar; }
        }
        var matchCount = Object.keys(match).length;
        if (matchCount === 0) return;
        $secretElements.each(function() {
            var $el = $(this);
            var html = $el.html();
            if (!html) return;
            for (var code in match) {
                var encryptedChar = String.fromCharCode(parseInt(code));
                var realChar = String.fromCharCode(match[code]);
                var escapedChar = encryptedChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                var regex = new RegExp(escapedChar, 'g');
                html = html.replace(regex, realChar);
            }
            if ($el.html() !== html) { $el.html(html); $el.removeClass('font-cxsecret'); }
        });
        log('✅ 字体解密完成！已还原 ' + matchCount + ' 个字符', 'green');
    } catch(e) { log('❌ 字体解密失败: ' + e.message, 'red'); }
}
function base64ToUint8Array(base64) {
    var data = window.atob(base64);
    var buf = new Uint8Array(data.length);
    for (var i = 0; i < data.length; i++) buf[i] = data.charCodeAt(i);
    return buf;
}
function getSettingsPanelHTML() {
    return '<div id="ne-21box" style="position:fixed;top:5%;right:20%;z-index:99999;width:420px;background:#fff;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.15);font-size:14px;">' +
        '<div id="ne-21drag-handle" style="display:flex;justify-content:space-between;padding:12px 15px;border-bottom:1px solid #eee;cursor:move;user-select:none;">' +
        '<h3 style="margin:0;font-size:16px;pointer-events:none;">📚 学习通助手(分享框架) v1.0.0 <span style="font-size:11px;color:#999;">（按住拖动）</span></h3>' +
        '<span id="ne-21close" style="cursor:pointer;color:#999;">[F9隐藏]</span>' +
        '</div>' +
        '<div id="ne-21notice" style="padding:12px 15px;border-bottom:1px solid #eee;background:#f9f9f9;"></div>' +
        '<div style="padding:15px;">' +
        '<div style="margin-bottom:12px;padding:10px;background:#f5f5f5;border-radius:4px;">' +
        '<div style="margin-bottom:8px;font-weight:bold;">🔍 自动搜题</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
        '<select id="apiModeSel" style="padding:6px;border:1px solid #ddd;border-radius:4px;">' +
        '<option value="ai"' + (getApiMode() === 'ai' ? ' selected' : '') + '>AI大模型</option>' +
        '<option value="bank"' + (getApiMode() !== 'ai' ? ' selected' : '') + '>题库接口</option>' +
        '</select>' +
        '<input type="text" id="apiUrlInput" placeholder="接口地址，多个用英文逗号分隔" value="' + getApiUrlList().join(',') + '" style="flex:1;min-width:140px;padding:6px;border:1px solid #ddd;border-radius:4px;">' +
        '<button id="saveApiBtn" style="padding:6px 12px;background:#4CAF50;color:#fff;border:none;border-radius:4px;cursor:pointer;">保存</button>' +
        '<button id="testApiBtn" style="padding:6px 12px;background:#2196F3;color:#fff;border:none;border-radius:4px;cursor:pointer;">测试</button>' +
        '</div>' +
        '<div id="apiModelRow" style="display:' + (getApiMode() === 'ai' ? 'flex' : 'none') + ';gap:6px;flex-wrap:wrap;margin-top:6px;">' +
        '<input type="text" id="apiModelInput" placeholder="AI模型名" value="' + getApiModel() + '" style="flex:1;min-width:140px;padding:6px;border:1px solid #ddd;border-radius:4px;">' +
        '<span style="font-size:12px;color:#999;line-height:30px;">模型名</span>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">' +
        '<input type="password" id="apiKeyInput" placeholder="API密钥（请填你自己的）" style="flex:1;min-width:140px;padding:6px;border:1px solid #ddd;border-radius:4px;">' +
        '<button id="saveApiKeyBtn" style="padding:6px 12px;background:#2196F3;color:#fff;border:none;border-radius:4px;cursor:pointer;">存密钥</button>' +
        '</div>' +
        '<div style="margin-top:8px;"><input type="checkbox" id="setting_autoSearch" ' + (CONFIG.autoSearch ? 'checked' : '') + '> <label>自动搜题（AI/题库），搜不到再人工问答</label></div>' +
        '<div style="font-size:12px;color:#999;margin-top:4px;">AI接口失败会自动尝试 DeepSeek 官方接口（使用同一个密钥）</div>' +
        '<div id="apiTestResult" style="font-size:12px;margin-top:5px;color:#666;"></div>' +
        '</div>' +
        '<div id="ne-21pending" style="display:none;"></div>' +
        '<button id="moreSettingsBtn" style="padding:6px 12px;background:#4CAF50;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-bottom:10px;">⚙️ 更多设置</button>' +
        '<div id="moreSettings" style="display:none;margin-top:12px;">' +
        '<div style="margin:8px 0;">' +
        '<label style="display:inline-block;width:120px;">⏱️ 答题间隔(ms):</label>' +
        '<input type="number" id="answerIntervalInput" value="' + CONFIG.answerInterval + '" style="width:80px;padding:4px;border:1px solid #ddd;border-radius:4px;" min="1000" max="10000" step="500">' +
        '<span style="font-size:12px;color:#999;">(默认5000ms，实际随机±20%)</span>' +
        '</div>' +
        '<div style="margin:8px 0;">' +
        '<label style="display:inline-block;width:120px;">🎬 视频倍速:</label>' +
        '<input type="range" id="videoRateSlider" min="1" max="8" step="0.25" value="' + CONFIG.videoRate + '" style="width:160px;vertical-align:middle;">' +
        '<span id="videoRateValue" style="font-size:12px;color:#666;margin-left:6px;">' + CONFIG.videoRate.toFixed(2) + 'x</span>' +
        '</div>' +
        '<div style="margin:8px 0;">' +
        '<label style="display:inline-block;width:120px;">📡 视频模式:</label>' +
        '<label><input type="radio" name="videoMode" value="normal" ' + (CONFIG.videoMode === 'normal' ? 'checked' : '') + '> 正常播放</label>' +
        '<label style="margin-left:10px;"><input type="radio" name="videoMode" value="simulate" ' + (CONFIG.videoMode === 'simulate' ? 'checked' : '') + '> 模拟上报</label>' +
        '</div>' +
        '<div style="margin:8px 0;"><input type="checkbox" id="setting_handleVideoQuiz" ' + (CONFIG.handleVideoQuiz ? 'checked' : '') + '> <label>视频答题（弹题自动处理）</label></div>' +
        '<div style="margin:8px 0;"><input type="checkbox" id="setting_autoSubmit" ' + (CONFIG.autoSubmit ? 'checked' : '') + '> <label>测验自动提交</label></div>' +
        '<div style="margin:8px 0;"><input type="checkbox" id="setting_forceSubmit" ' + (CONFIG.forceSubmit ? 'checked' : '') + '> <label>测验强制提交</label></div>' +
        '<div style="margin:8px 0;"><input type="checkbox" id="setting_autoNextExam" ' + (CONFIG.autoNextExam ? 'checked' : '') + '> <label>考试自动跳转</label></div>' +
        '<div style="margin:8px 0;"><input type="checkbox" id="setting_insertAnswer" ' + (CONFIG.insertAnswer ? 'checked' : '') + '> <label>答案插入题目</label></div>' +
        '</div>' +
        '<div id="ne-21log" style="margin-top:12px;max-height:250px;overflow-y:auto;font-size:12px;background:#fafafa;border-radius:4px;padding:8px;"></div>' +
        '</div>' +
        '</div>';
}
function bindSettingUI(targetDoc) {
    var $box = $('#ne-21box', targetDoc);
    var boxEl = $box[0];
    if (boxEl) {
        var savedLeft = GM_getValue('panel_left', null);
        var savedTop = GM_getValue('panel_top', null);
        if (savedLeft !== null && savedTop !== null) {
            var vw = $(targetDoc).width();
            var vh = $(targetDoc).height();
            var maxLeft = Math.max(0, vw - boxEl.offsetWidth);
            var maxTop = Math.max(0, vh - boxEl.offsetHeight);
            savedLeft = Math.max(0, Math.min(maxLeft, savedLeft));
            savedTop = Math.max(0, Math.min(maxTop, savedTop));
            $box.css({ left: savedLeft + 'px', top: savedTop + 'px', right: 'auto' });
        }
        var $handle = $('#ne-21drag-handle', targetDoc);
        var dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;
        $handle.off('mousedown.panelDrag').on('mousedown.panelDrag', function(e) {
            if ($(e.target).is('span, button, input, a')) return;
            dragging = true;
            var rect = boxEl.getBoundingClientRect();
            origLeft = rect.left; origTop = rect.top;
            startX = e.clientX; startY = e.clientY;
            $box.css({ left: origLeft + 'px', top: origTop + 'px', right: 'auto' });
            e.preventDefault();
        });
        $(targetDoc).off('mousemove.panelDrag mouseup.panelDrag')
            .on('mousemove.panelDrag', function(e) {
                if (!dragging) return;
                var dx = e.clientX - startX, dy = e.clientY - startY;
                var newLeft = origLeft + dx, newTop = origTop + dy;
                var vw = $(targetDoc).width(), vh = $(targetDoc).height();
                newLeft = Math.max(0, Math.min(vw - boxEl.offsetWidth, newLeft));
                newTop = Math.max(0, Math.min(vh - boxEl.offsetHeight, newTop));
                $box.css({ left: newLeft + 'px', top: newTop + 'px' });
            })
            .on('mouseup.panelDrag', function() {
                if (!dragging) return;
                dragging = false;
                var rect = boxEl.getBoundingClientRect();
                GM_setValue('panel_left', Math.round(rect.left));
                GM_setValue('panel_top', Math.round(rect.top));
            });
    }

    $('#ne-21close', targetDoc).off('click').on('click', function() {
        $('#ne-21box', targetDoc).css('display', 'none');
        isBoxHidden = true;
    });
    var moreBtn = targetDoc.getElementById('moreSettingsBtn');
    var moreSet = targetDoc.getElementById('moreSettings');
    var visible = false;
    if (moreBtn) {
        moreBtn.onclick = function() {
            moreSet.style.display = visible ? 'none' : 'block';
            moreBtn.textContent = visible ? '⚙️ 更多设置' : '✖️ 关闭设置';
            visible = !visible;
        };
    }
    ensureManualBindings(targetDoc);
    var apiUrlInput = targetDoc.getElementById('apiUrlInput');
    if (apiUrlInput && !apiUrlInput.value) { apiUrlInput.value = getApiUrlList().join(','); }
    var apiKeyInput = targetDoc.getElementById('apiKeyInput');
    if (apiKeyInput && getApiKey()) { apiKeyInput.placeholder = '已设置'; }
    var apiModeSel = targetDoc.getElementById('apiModeSel');
    var apiModelInput = targetDoc.getElementById('apiModelInput');
    var apiModelRow = targetDoc.getElementById('apiModelRow');
    function updateApiModeUI() {
        if (!apiModeSel) return;
        var isAi = apiModeSel.value === 'ai';
        if (apiModelRow) { apiModelRow.style.display = isAi ? 'flex' : 'none'; }
        GM_setValue('api_mode', isAi ? 'ai' : 'bank');
    }
    if (apiModeSel) {
        apiModeSel.onchange = updateApiModeUI;
    }
    var saveApiBtn = targetDoc.getElementById('saveApiBtn');
    if (saveApiBtn) {
        saveApiBtn.onclick = function() {
            updateApiModeUI();
            var urls = saveApiConfig(apiUrlInput ? apiUrlInput.value : '', apiModelInput ? apiModelInput.value : '');
            if (apiUrlInput) apiUrlInput.value = urls.join(',');
            var modeName = getApiMode() === 'ai' ? 'AI大模型' : '题库接口';
            log('🔗 已保存(' + modeName + '): ' + urls.join(' | ') + (getApiMode() === 'ai' ? ' | 模型: ' + getApiModel() : ''), 'green');
        };
    }
    var saveApiKeyBtn = targetDoc.getElementById('saveApiKeyBtn');
    if (saveApiKeyBtn) {
        saveApiKeyBtn.onclick = function() {
            var key = apiKeyInput ? apiKeyInput.value.trim() : '';
            if (key) {
                GM_setValue('api_key', key);
                if (apiKeyInput) { apiKeyInput.value = ''; apiKeyInput.placeholder = '已设置'; }
                log('🔑 自定义API密钥已保存', 'green');
            } else {
                GM_deleteValue('api_key');
                if (apiKeyInput) { apiKeyInput.value = ''; apiKeyInput.placeholder = '已设置(mxwell)'; }
                log('🔑 已清除密钥，请在面板填写自己的密钥', 'green');
            }
        };
    }
    var testApiBtn = targetDoc.getElementById('testApiBtn');
    if (testApiBtn) {
        testApiBtn.onclick = function() {
            var $r = $('#apiTestResult', targetDoc);
            if ($r.length) { $r.html('⏳ 正在测试接口...').css('color', '#666'); }
            testApiConnection().then(function(url) {
                if ($r.length) { $r.html('✅ 接口可用: ' + url).css('color', 'green'); }
                log('✅ 自动搜题接口测试通过: ' + url, 'green');
            }).catch(function(err) {
                if ($r.length) { $r.html('❌ 接口测试失败: ' + err).css('color', 'red'); }
                log('❌ 自动搜题接口测试失败: ' + err, 'red');
            });
        };
    }

    var answerIntervalInput = targetDoc.getElementById('answerIntervalInput');
    if (answerIntervalInput) {
        answerIntervalInput.addEventListener('change', function(e) {
            var newTime = parseInt(e.target.value);
            if (newTime >= 1000 && newTime <= 10000) {
                updateConfig('answerInterval', newTime);
                log('⚙️ 答题间隔已实时更新为: ' + newTime + 'ms (实际随机 ±20%)', 'blue');
            } else {
                e.target.value = CONFIG.answerInterval;
                log('⚠️ 答题间隔需在 1000~10000ms 之间，已恢复原值', 'orange');
            }
        });
    }

    var rateSlider = targetDoc.getElementById('videoRateSlider');
    var rateValue = targetDoc.getElementById('videoRateValue');
    if (rateSlider) {
        rateSlider.addEventListener('input', function() {
            if (rateValue) rateValue.textContent = parseFloat(this.value).toFixed(2) + 'x';
        });
        rateSlider.addEventListener('change', function() {
            var newRate = parseFloat(this.value);
            if (newRate > 8) newRate = 8;
            updateConfig('videoRate', newRate);
            SettingsManager.saveVideoRate(CONFIG.videoRate);
            try {
                document.querySelectorAll('iframe').forEach(function(f) {
                    var d = f.contentDocument || (f.contentWindow && f.contentWindow.document);
                    if (!d) return;
                    var media = d.querySelector('video') || d.querySelector('audio');
                    if (media) {
                        media.playbackRate = newRate > 1 ? Math.min(newRate, 16) : 1;
                        log('📹 视频倍速已实时改为: ' + newRate.toFixed(2) + 'x', 'green');
                    }
                });
            } catch(e) {}
        });
    }

    $('input[name="videoMode"]', targetDoc).off('change').on('change', function() {
        var newMode = this.value;
        var changed = CONFIG.videoMode !== newMode;
        updateConfig('videoMode', newMode);
        SettingsManager.saveVideoMode(newMode);
        log('🎬 视频模式已切换为: ' + (newMode === 'simulate' ? '模拟上报' : '正常播放'), 'green');
        if (changed && currentVideoInterval) {
            log('🔄 当前视频任务将按新模式重跑', 'orange');
            clearInterval(currentVideoInterval);
            currentVideoInterval = null;
            if (currentVideoQuizObserver) {
                try { currentVideoQuizObserver.disconnect(); } catch(e) {}
                currentVideoQuizObserver = null;
            }
            stopQuizPoll();
            stopQuizObserverGuard();
            isProcessing = false;
            setTimeout(function() { startMission(); }, 1000);
        }
    });

    var checkboxes = ['handleVideoQuiz', 'autoSubmit', 'forceSubmit', 'autoNextExam', 'insertAnswer', 'autoSearch'];
    checkboxes.forEach(function(id) {
        var $cb = $('#setting_' + id, targetDoc);
        if (!$cb.length) return;
        $cb.off('change').on('change', function() {
            var checked = this.checked;
            updateConfig(id, checked);

            if (id === 'handleVideoQuiz') {
                if (checked) {
                    try {
                        document.querySelectorAll('iframe').forEach(function(f) {
                            var d = f.contentDocument || (f.contentWindow && f.contentWindow.document);
                            if (d && d.body && d.querySelector('video')) {
                                observeVideoQuiz(d);
                                startQuizPoll(d);
                                startQuizObserverGuard();
                            }
                        });
                        log('👀 视频弹题监听已开启', 'green');
                    } catch(e) {}
                } else {
                    if (currentVideoQuizObserver) {
                        try { currentVideoQuizObserver.disconnect(); } catch(e) {}
                        currentVideoQuizObserver = null;
                    }
                    stopQuizPoll();
                    stopQuizObserverGuard();
                    log('👀 视频弹题监听已关闭', 'blue');
                }
            }

            if (id === 'autoSubmit' && checked && CONFIG.forceSubmit) {
                CONFIG.forceSubmit = false;
                SettingsManager.set('forceSubmit', false);
                $('#setting_forceSubmit', targetDoc).prop('checked', false);
                log('⚙️ 自动提交与强制提交互斥，已关闭强制提交', 'blue');
            }
            if (id === 'forceSubmit' && checked && CONFIG.autoSubmit) {
                CONFIG.autoSubmit = false;
                SettingsManager.set('autoSubmit', false);
                $('#setting_autoSubmit', targetDoc).prop('checked', false);
                log('⚙️ 强制提交与自动提交互斥，已关闭自动提交', 'blue');
            }
            if (id === 'autoNextExam') {
                log('⏭️ 考试自动跳转: ' + (checked ? '开' : '关'), 'blue');
            }
            if (id === 'insertAnswer') {
                log('📖 答案插入题目: ' + (checked ? '开' : '关'), 'blue');
            }
        });
    });
}
function showBox() {
    if (!CONFIG.showBox) return;
    try {
        var targetDoc = top.document;
        if (targetDoc.querySelector('#ne-21box')) {
            flushLogs();
            if (pendingAnswerRequest) renderPendingQuestionUI();
            return;
        }
    } catch(e) {}
    setTimeout(function() {
        try {
            var targetDoc = top.document;
            var boxHtml = getSettingsPanelHTML();
            $(targetDoc.body).append(boxHtml);
            bindSettingUI(targetDoc);
            $('#ne-21notice', targetDoc).html('<div style="font-size:12px;">💡 分享框架 v1.0.0 | 首次使用：先在「自动搜题」里配置你自己的API密钥 | F9隐藏/显示</div>');
            if (pendingAnswerRequest) renderPendingQuestionUI();
            flushLogs();
            showPikaqiu();
        } catch(e) { console.error('显示悬浮窗失败:', e); }
    }, 100);
}

// ==================== 初始化入口 ====================
$(function() {
    CONFIG.videoMode = GM_getValue('videoMode', CONFIG.videoMode);
    CONFIG.videoRate = GM_getValue('videoRate', CONFIG.videoRate);
    CONFIG.showProgressBar = GM_getValue('showProgressBar', CONFIG.showProgressBar);
    var settingsMap = { 'autoSubmit': 'autoSubmit', 'forceSubmit': 'forceSubmit', 'autoNextExam': 'autoNextExam', 'insertAnswer': 'insertAnswer', 'answerInterval': 'answerInterval', 'handleVideoQuiz': 'handleVideoQuiz' };
    for (var key in settingsMap) {
        var val = GM_getValue('setting_' + key, null);
        if (val === null) val = localStorage.getItem('setting_' + key);
        if (val !== null && val !== undefined) {
            if (key === 'answerInterval') { CONFIG[settingsMap[key]] = parseInt(val); }
            else { CONFIG[settingsMap[key]] = (val === 'true' || val === true); }
        }
    }
    $('.navshow').find('a:contains(体验新版)')[0] && $('.navshow').find('a:contains(体验新版)')[0].click();
    if (CONFIG.decryptFont) {
        setTimeout(function() { decryptFont(); }, 1000);
        setTimeout(function() { if ($('.font-cxsecret').length > 0) decryptFont(); }, 8000);
    }
    if (LOCATION.pathname == '/login' && CONFIG.autoLogin) {
        showBox();
        waitForElement('#phone').then(function() {
            $('#phone').val(CONFIG.loginPhone);
            $('#pwd').val(CONFIG.loginPassword);
            $('#loginBtn').click();
        });
    } else if (LOCATION.pathname.includes('/mycourse/studentstudy')) {
        showBox();
        log('✅ 初始化完毕！', 'green');
    } else if (LOCATION.pathname.includes('/knowledge/cards')) {
        showBox();
        var params = getTaskParams();
        if (!params || params == '$mArg') {
            log('⚠️ 无任务点可处理', 'red');
            if (!hasTriggeredNoTaskJump) {
                hasTriggeredNoTaskJump = true;
                log('🔄 检测到无任务点，尝试跳转到下一章节...', 'blue');
                setTimeout(function() {
                    var nextBtn = top.document.querySelector('#mainid > .prev_next.next:not(.disabled)') || top.document.querySelector('#prevNextFocusNext:not(.disabled)') || top.document.querySelector('.prev_next.next:not(.disabled)') || $('.prev_next.next:not(.disabled)')[0];
                    if (nextBtn && !nextBtn.disabled && !nextBtn.classList.contains('disabled')) { log('✅ 找到下一节按钮，即将跳转', 'green'); nextBtn.click(); }
                    else { log('📚 已是最后一章，无更多章节', 'green'); }
                }, 2000);
            }
            return;
        }
        try {
            var allTasks = $.parseJSON(params)['attachments'];
            if (!allTasks || allTasks.length <= 0) {
                log('⚠️ 无任务点可处理', 'red');
                if (!hasTriggeredNoTaskJump) {
                    hasTriggeredNoTaskJump = true;
                    setTimeout(function() {
                        var nextBtn = top.document.querySelector('#mainid > .prev_next.next:not(.disabled)') || top.document.querySelector('#prevNextFocusNext:not(.disabled)') || top.document.querySelector('.prev_next.next:not(.disabled)') || $('.prev_next.next:not(.disabled)')[0];
                        if (nextBtn && !nextBtn.disabled && !nextBtn.classList.contains('disabled')) { nextBtn.click(); }
                    }, 2000);
                }
                return;
            }
        } catch(e) { log('⚠️ 解析任务参数失败', 'red'); return; }
        waitForElement('.wrap .ans-cc .ans-attach-ct').then(function() {
            if (top.checkJob) top.checkJob = function() { return false; };
            var allTasks = $.parseJSON(params)['attachments'];
            defaults = $.parseJSON(params)['defaults'];
            domList = [];
            var pendingTasks = [];
            for (var i = 0; i < allTasks.length; i++) {
                var task = allTasks[i];
                if (!isTaskCompleted(task)) { pendingTasks.push(task); }
                else { var taskName = task.property ? (task.property.name || task.property.title || '未知') : '未知'; log('✅ 任务点 ' + taskName + ' 已完成，跳过', 'green'); }
            }
            totalMissionCount = allTasks.length;
            pendingMissionCount = pendingTasks.length;
            completedMissionCount = 0;
            if (pendingMissionCount === 0) { log('✅ 所有任务点已完成', 'green'); setTimeout(function() { goToNext(); }, 2000); return; }
            log('📋 发现 ' + totalMissionCount + ' 个任务点，其中 ' + pendingMissionCount + ' 个待处理', 'green');
            taskList = [];
            var newDomList = [];
            $('.wrap .ans-cc .ans-attach-ct').each(function(i, t) {
                if (i < allTasks.length && !isTaskCompleted(allTasks[i])) { taskList.push(allTasks[i]); newDomList.push($(t).find('iframe')); }
            });
            domList = newDomList;
            if (taskList.length > 0) {
                log('🚀 开始处理 ' + taskList.length + ' 个待完成任务点', 'green');
                startMission();
            } else { log('✅ 所有任务点已完成', 'green'); setTimeout(function() { goToNext(); }, 2000); }
        }).catch(function() {
            log('❌ 等待元素超时', 'red');
            if (!hasTriggeredNoTaskJump) { hasTriggeredNoTaskJump = true; setTimeout(function() { goToNext(); }, 2000); }
        });
    } else if (LOCATION.pathname.includes('/exam/test/reVersionTestStartNew')) {
        showBox();
        waitForElement('.mark_table .whiteDiv').then(function() { processExam(); });
    } else if (LOCATION.pathname.includes('/mooc2/work/dowork')) {
        showBox();
        waitForElement('.mark_table form').then(function() { processHomework(); });
    } else if (LOCATION.pathname.includes('/work/phone/doHomeWork')) {
        var oldAlert = UNSAFE_WIN.alert;
        UNSAFE_WIN.alert = function(msg) { if (msg == '保存成功') return; return oldAlert(msg); };
        var oldConfirm = UNSAFE_WIN.confirm;
        UNSAFE_WIN.confirm = function(msg) { if (msg.includes('确认提交') || msg.includes('未做完')) return true; return oldConfirm(msg); };
    }
});
