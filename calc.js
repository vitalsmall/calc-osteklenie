/**
 * calc.js — движок и UI калькулятора «Предварительный расчёт стоимости»
 *
 * Зависимости: custom.js (window.CALC_CONFIG) должен загрузиться раньше.
 * Никаких библиотек. Классический IIFE, как на glass-ter.ru.
 *
 * Слои:
 *   1. Чистая логика  — площадь, створки, рекомендация Coupe/7T, ориентир цены
 *   2. Состояние      — STATE, чтение полей формы
 *   3. Отрисовка      — эскиз, план, сводка, цена
 *   4. Заявка         — мягкая валидация, без сети
 */
(function () {
  'use strict';

  var C = window.CALC_CONFIG;
  if (!C) {
    console.error('calc.js: не найден CALC_CONFIG. Подключите custom.js перед calc.js.');
    return;
  }

  /* ========================================================================
   * 1. ЧИСТАЯ ЛОГИКА  (эквивалент constructor-logic.js)
   * ======================================================================== */

  /** Приводит значение к положительному числу, иначе 0. */
  function num(v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? n : 0;
  }

  /** Рабочая высота проёма, мм. */
  function effHeightMm(state) {
    return num(state && state.dims && state.dims.heightMm);
  }

  /** Развёрнутая длина проёма, мм (для любой формы — одно поле). */
  function totalWidthMm(state) {
    return num(state && state.dims && state.dims.totalLengthMm);
  }

  /**
   * Площадь остекления, м².
   * S = Lмм × Hмм / 1 000 000
   */
  function computeAreaM2(state) {
    return (totalWidthMm(state) * effHeightMm(state)) / 1e6;
  }

  /**
   * Предварительное число створок: ~600 мм на полотно, clamp 2…14.
   */
  function suggestPanelCount(widthMm) {
    var raw = Math.round(num(widthMm) / C.PANEL_PITCH_MM);
    return Math.max(C.PANEL_MIN, Math.min(C.PANEL_MAX, raw));
  }

  /**
   * Рекомендация системы.
   * Возвращает:
   *   primary    — 'coupe' | '7t' | 'consultation'
   *   offerBoth  — прямой проём, высота ≤ 2.8 м, есть парковка
   *   sevenT     — 'ok' | 'consultation' | 'blocked'
   *   flags      — канонические id ограничений
   */
  function recommendSystem(state) {
    var shape = state && state.shape;
    var usage = state && state.usage;
    var parkingSide = state && state.parkingSide;
    var objectType = state && state.objectType;
    var h = effHeightMm(state);
    var flags = [];

    var forceConsultation = shape === 'complex-curve' || h > C.MAX_COUPE_H_MM;

    var sevenT;
    if (forceConsultation || h > C.MAX_7T_H_MM) {
      sevenT = 'blocked';
    } else if (C.CORNERED_SHAPES.indexOf(shape) !== -1 || parkingSide === 'none') {
      sevenT = 'consultation';
    } else {
      sevenT = 'ok';
    }

    var offerBoth = shape === 'straight' && h <= C.MAX_7T_H_MM && parkingSide !== 'none';

    var primary;
    if (forceConsultation) {
      primary = 'consultation';
    } else if (offerBoth && usage === 'full-open') {
      primary = '7t';
    } else {
      primary = 'coupe';
    }

    if (forceConsultation) flags.push('engineering-required');
    if (sevenT === 'blocked' && !forceConsultation) flags.push('7t-height-exceeded');
    if (sevenT === 'consultation') flags.push('7t-consultation');
    if (parkingSide === 'none') flags.push('no-parking-pocket');
    if (shape === 'complex-curve') flags.push('send-plan');
    if (C.TECH_PACKAGE_OBJECTS.indexOf(objectType) !== -1) flags.push('technical-package');

    return { primary: primary, offerBoth: offerBoth, sevenT: sevenT, flags: flags };
  }

  /**
   * Ориентир стоимости.
   * Для consultation цена скрывается — «Оценим по фото или плану».
   * Иначе: округлённая площадь × ставка.
   */
  function estimateCost(state, recommendation) {
    if (recommendation && recommendation.primary === 'consultation') {
      return {
        suppressed: true,
        fromRub: null,
        text: C.CONSULTATION_TEXT,
        disclaimer: C.DISCLAIMER
      };
    }
    var fromRub = Math.round(computeAreaM2(state) * C.BASE_RATE_RUB);
    return {
      suppressed: false,
      fromRub: fromRub,
      text: 'Ориентир: от ' + formatRub(fromRub) + ' ₽',
      disclaimer: C.DISCLAIMER
    };
  }

  function formatRub(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  }

  function formatMm(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  }

  function findName(list, id, fallback) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].name;
    return fallback || 'не указано';
  }

  function summarize(state, recommendation, cost) {
    var lines = [];
    lines.push('Объект: ' + findName(C.OBJECT_TYPES, state.objectType));
    lines.push('Задача: ' + findName(C.USAGE_OPTIONS, state.usage));
    lines.push('Форма: ' + findName(C.SHAPES, state.shape));
    lines.push('Размеры: ' + totalWidthMm(state) + '×' + effHeightMm(state) + ' мм');
    lines.push('Площадь: ' + computeAreaM2(state).toFixed(2).replace('.', ',') + ' м²');
    var sys = recommendation.primary === 'consultation' ? 'инженерный расчёт'
      : (recommendation.primary === '7t' ? '7T' : 'Coupe');
    lines.push('Система: ' + sys);
    lines.push('Стекло: ' + findName(C.GLASS_TYPES, state.glassType, 'Прозрачное'));
    if (state.objectState) lines.push('Состояние: ' + findName(C.OBJECT_STATES, state.objectState));
    if (state.timing) lines.push('Сроки: ' + findName(C.TIMING_OPTIONS, state.timing));
    var opts = (state.options || []).map(function (k) {
      return findName(C.OPTIONS, k, k);
    });
    lines.push('Опции: ' + (opts.length ? opts.join(', ') : 'без дополнительных опций'));
    lines.push(cost.suppressed ? 'Цена: оценим по фото или плану' : cost.text);
    return lines.join('\n');
  }

  /* Публичный API логики — как window.GLASSTER.logic на оригинале */
  window.GLASSTER = window.GLASSTER || {};
  window.GLASSTER.logic = {
    num: num,
    effHeightMm: effHeightMm,
    totalWidthMm: totalWidthMm,
    computeAreaM2: computeAreaM2,
    suggestPanelCount: suggestPanelCount,
    recommendSystem: recommendSystem,
    estimateCost: estimateCost,
    summarize: summarize,
    formatRub: formatRub,
    formatMm: formatMm
  };

  /* ========================================================================
   * 2. СОСТОЯНИЕ И ПРИВЯЗКА К ФОРМЕ
   * ======================================================================== */

  var STATE = {
    objectType: 'terrace',
    usage: 'protect',
    shape: 'straight',
    dims: {
      totalLengthMm: C.DIMS.totalLengthMm.def,
      heightMm: C.DIMS.heightMm.def
    },
    parkingSide: 'left',
    options: [],
    glassType: 'clear',
    timing: undefined,
    objectState: undefined,
    services: [],
    needsMeasure: 'no',
    system: undefined,
    userOverrode: false
  };

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function init() {
    var section = document.getElementById('constructor');
    if (!section) return;
    buildForm();
    wireControls();
    wireLead();
    wireDialogs();
    render();
  }

  /* Строим разметку вопросов из CONFIG — одна точка правды */
  function buildForm() {
    var flow = document.getElementById('cstr-flow');
    if (!flow) return;

    flow.innerHTML =
      row('objectType', 'Объект', radios('objectType', C.OBJECT_TYPES, STATE.objectType, 'chip')) +
      row('usage', 'Как будете пользоваться', radios('usage', C.USAGE_OPTIONS, STATE.usage, 'opt')) +
      row('shape', 'Форма проёма', shapeRadios()) +
      row('dims', 'Размеры', dimSliders()) +
      '<div class="va-row" id="row-parking">' +
        '<div class="va-key">Парковка створок</div>' +
        '<div class="va-val">' + radios('parkingSide', C.PARKING_OPTIONS, STATE.parkingSide, 'opt') + '</div>' +
      '</div>' +
      row('system', 'Система', radios('systemOverride', C.SYSTEM_OPTIONS, 'auto', 'opt')) +
      row('glass', 'Тип стекла <button type="button" class="va-info" data-info-open aria-controls="glass-types-dialog" title="Сравнение типов стекла">' + infoIcon() + '</button>',
        radios('glassType', C.GLASS_TYPES, STATE.glassType, 'opt')) +
      row('objectState', 'Состояние объекта', radios('objectState', C.OBJECT_STATES, '', 'opt', true)) +
      row('timing', 'Сроки', radios('timing', C.TIMING_OPTIONS, '', 'opt', true)) +
      row('options', 'Опции', checks('options', C.OPTIONS)) +
      row('services', 'Услуги', serviceChecks());
  }

  function row(id, label, body) {
    return '<div class="va-row" data-row="' + id + '">' +
      '<div class="va-key">' + label + '</div>' +
      '<div class="va-val">' + body + '</div>' +
    '</div>';
  }

  function radios(name, items, current, kind, optional) {
    return '<div class="' + (kind === 'chip' ? 'va-chips' : 'va-opts') + '">' +
      items.map(function (it) {
        var checked = it.id === current ? ' checked' : '';
        var cls = kind === 'chip' ? 'cstr-chip' : 'va-opt';
        return '<label class="' + cls + '">' +
          '<input type="radio" name="' + name + '" value="' + it.id + '"' + checked + '>' +
          '<span>' + it.name + '</span>' +
        '</label>';
      }).join('') +
    '</div>';
  }

  function checks(name, items) {
    return '<div class="va-opts">' + items.map(function (it) {
      var extra = '';
      if (it.id === 'plisse') {
        extra = ' <button type="button" class="va-info" data-info-open aria-controls="plisse-dialog" title="Москитная сетка-плиссе">' + infoIcon() + '</button>';
      }
      return '<label class="va-check">' +
        '<input type="checkbox" name="' + name + '" value="' + it.id + '">' +
        '<span>' + it.name + extra + '</span>' +
      '</label>';
    }).join('') + '</div>';
  }

  function serviceChecks() {
    return '<div class="va-opts">' + C.SERVICES.map(function (it) {
      var extra = '';
      if (it.id === 'mobile-office') {
        extra = ' <button type="button" class="va-info" data-info-open aria-controls="mobile-office-dialog" title="Выезд инженера с макетами">' + infoIcon() + '</button>';
      }
      return '<label class="va-check">' +
        '<input type="checkbox" name="services" value="' + it.id + '">' +
        '<span>' + it.name + extra + '</span>' +
      '</label>';
    }).join('') + '</div>';
  }

  function infoIcon() {
    return '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 11v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="8" r="1" fill="currentColor"/></svg>';
  }

  function shapeRadios() {
    var icons = {
      'straight':      '<svg viewBox="0 0 48 28"><path d="M4 22h40" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="8" y="6" width="32" height="16" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
      'corner-l':      '<svg viewBox="0 0 48 28"><path d="M6 22h22V8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 22V12h18V8" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
      'u-shape':       '<svg viewBox="0 0 48 28"><path d="M8 8v14h32V8" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
      'angled-bay':    '<svg viewBox="0 0 48 28"><path d="M4 22l10-12h20l10 12" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
      'complex-curve': '<svg viewBox="0 0 48 28"><path d="M6 20c8-16 28-16 36 0" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'
    };
    return '<div class="va-shapes">' + C.SHAPES.map(function (it) {
      var checked = it.id === STATE.shape ? ' checked' : '';
      return '<label class="va-shape">' +
        '<input type="radio" name="shape" value="' + it.id + '"' + checked + '>' +
        '<span><i class="va-shape__ico">' + (icons[it.id] || '') + '</i>' + it.name.replace(' / ', '<br>') + '</span>' +
      '</label>';
    }).join('') + '</div>';
  }

  function dimSliders() {
    var L = C.DIMS.totalLengthMm;
    var H = C.DIMS.heightMm;
    return '<div class="va-dims">' +
      slider('dim-length', 'totalLengthMm', 'Длина проёма (развёрнутая)', L, STATE.dims.totalLengthMm) +
      slider('dim-height', 'heightMm', 'Высота проёма', H, STATE.dims.heightMm) +
    '</div>';
  }

  function slider(id, name, label, spec, value) {
    var pct = ((value - spec.min) / (spec.max - spec.min)) * 100;
    return '<label class="va-dim">' +
      '<span class="va-dim__lab">' + label +
        ' <b class="va-dim__out" id="' + id + '-out" data-out>' + formatMm(value) + ' мм</b>' +
      '</span>' +
      '<input class="cstr-range" id="' + id + '" type="range" name="' + name + '"' +
        ' min="' + spec.min + '" max="' + spec.max + '" step="' + spec.step + '"' +
        ' value="' + value + '" data-out="' + id + '-out" style="--pct:' + pct + '%">' +
    '</label>';
  }

  function wireControls() {
    var form = document.getElementById('cstr-flow');
    if (!form) return;

    form.addEventListener('change', function (ev) {
      var t = ev.target;
      if (!t || !t.name) return;
      switch (t.name) {
        case 'objectType': STATE.objectType = t.value; break;
        case 'usage': STATE.usage = t.value; break;
        case 'shape': STATE.shape = t.value; break;
        case 'systemOverride':
          if (t.value === 'coupe' || t.value === '7t') {
            STATE.system = t.value;
            STATE.userOverrode = true;
          } else {
            STATE.system = undefined;
            STATE.userOverrode = false;
          }
          break;
        case 'parkingSide': STATE.parkingSide = t.value; break;
        case 'options':
          STATE.options = checkedValues(form, 'options');
          break;
        case 'glassType': STATE.glassType = t.value; break;
        case 'timing': STATE.timing = t.value; break;
        case 'objectState': STATE.objectState = t.value; break;
        case 'services':
          STATE.services = checkedValues(form, 'services');
          STATE.needsMeasure = STATE.services.indexOf('engineer-measure') !== -1 ? 'yes' : 'no';
          break;
        default:
          readDim(t);
      }
      render();
    });

    form.addEventListener('input', function (ev) {
      var t = ev.target;
      if (t && t.classList && t.classList.contains('cstr-range')) {
        readDim(t);
        var out = document.getElementById(t.getAttribute('data-out'));
        if (out) out.textContent = formatMm(t.value) + ' мм';
        paintRange(t);
        render();
      }
    });

    $all('.cstr-range', form).forEach(paintRange);
  }

  function checkedValues(form, name) {
    return $all('input[name="' + name + '"]:checked', form).map(function (el) { return el.value; });
  }

  function readDim(t) {
    if (t.name === 'totalLengthMm' || t.name === 'heightMm') {
      var n = parseInt(t.value, 10);
      STATE.dims[t.name] = isFinite(n) ? n : 0;
    }
  }

  function paintRange(el) {
    var min = Number(el.min), max = Number(el.max), val = Number(el.value);
    var pct = max === min ? 0 : ((val - min) / (max - min)) * 100;
    el.style.setProperty('--pct', pct + '%');
  }

  /* ========================================================================
   * 3. ОТРИСОВКА
   * ======================================================================== */

  function render() {
    var asked = STATE.shape === 'straight';
    var work = asked ? STATE : Object.assign({}, STATE, { parkingSide: 'left' });

    var parkingRow = document.getElementById('row-parking');
    if (parkingRow) parkingRow.hidden = !asked;

    var reco = recommendSystem(work);
    var cost = estimateCost(work, reco);
    var area = computeAreaM2(work);
    var totalW = totalWidthMm(work);
    var panels = suggestPanelCount(totalW);
    var isConsultation = reco.primary === 'consultation';
    var drawnSystem = (!isConsultation && STATE.userOverrode && STATE.system)
      ? STATE.system
      : reco.primary;

    paintSketch(STATE.objectType, STATE.shape, panels, STATE.options.indexOf('plisse') !== -1, isConsultation);
    paintResult(cost, reco);
    paintRecap(work, drawnSystem, cost, area, panels);
    paintMeta(area, panels, drawnSystem, reco);
  }

  function paintResult(cost, reco) {
    var amount = document.getElementById('cstr-estimate-amount');
    var disc = document.getElementById('cstr-estimate-disclaimer');
    var result = document.getElementById('cstr-result');
    var limits = document.getElementById('cstr-limits');
    var flagsEl = document.getElementById('cstr-flags');

    if (amount) amount.textContent = cost.text;
    if (disc) disc.textContent = cost.disclaimer;
    if (result) result.classList.toggle('is-consultation', !!cost.suppressed);

    var show = !cost.suppressed && reco.flags.length > 0;
    if (limits) {
      limits.hidden = !show;
      if (!show) limits.open = false;
    }
    if (flagsEl) {
      flagsEl.innerHTML = '';
      if (show) {
        reco.flags.forEach(function (f) {
          var li = document.createElement('li');
          li.textContent = C.FLAG_MESSAGES[f] || f;
          flagsEl.appendChild(li);
        });
      }
    }
  }

  function systemRecapLabel(state, drawnSystem, cost) {
    if (cost && cost.suppressed) return 'инженерный расчёт';
    var sysName = drawnSystem === '7t' ? '7T' : 'Coupe';
    return state.userOverrode ? sysName : sysName + ' (рекомендуем)';
  }

  function paintRecap(state, drawnSystem, cost, area, panels) {
    var tbody = document.getElementById('cstr-params');
    if (!tbody) return;
    var opts = (state.options || []).map(function (k) { return findName(C.OPTIONS, k, k); });
    var svcs = (state.services || []).map(function (k) { return findName(C.SERVICES, k, k); });
    var rows = [
      ['Объект', findName(C.OBJECT_TYPES, state.objectType)],
      ['Форма', findName(C.SHAPES, state.shape)],
      ['Размеры', formatMm(totalWidthMm(state)) + '×' + formatMm(effHeightMm(state)) + ' мм'],
      ['Площадь', area.toFixed(2).replace('.', ',') + ' м² · ~' + panels + ' ств.'],
      ['Система', systemRecapLabel(state, drawnSystem, cost)],
      ['Стекло', findName(C.GLASS_TYPES, state.glassType, 'Прозрачное')],
      ['Состояние объекта', state.objectState ? findName(C.OBJECT_STATES, state.objectState) : 'не указано'],
      ['Сроки', state.timing ? findName(C.TIMING_OPTIONS, state.timing) : 'не указаны'],
      ['Опции', opts.length ? opts.join(', ') : 'без дополнительных опций'],
      ['Услуги', svcs.length ? svcs.join(', ') : 'без выезда']
    ];
    tbody.innerHTML = rows.map(function (r) {
      return '<tr><th scope="row">' + r[0] + '</th><td>' + r[1] + '</td></tr>';
    }).join('');
  }

  function paintMeta(area, panels, drawnSystem, reco) {
    var el = document.getElementById('cstr-meta');
    if (!el) return;
    if (reco.primary === 'consultation') {
      el.textContent = 'Для этой геометрии нужен инженерный расчёт.';
      return;
    }
    var sys = drawnSystem === '7t' ? '7T' : 'Coupe';
    var extra = reco.offerBoth ? ' Для прямого проёма возможны обе системы.' : '';
    el.textContent = 'Подойдёт ' + sys + '. Площадь ' +
      area.toFixed(2).replace('.', ',') + ' м², ориентировочно ' + panels + ' створок.' + extra;
  }

  /* ---------- Эскиз: профиль + план (как paintProfile / paintPlan) ---------- */

  var SVGNS = 'http://www.w3.org/2000/svg';

  function svgEl(name, attrs) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function footprintFor(shape) {
    switch (shape) {
      case 'straight':   return [{ x: -2.0, z: 0 }, { x: 2.0, z: 0 }];
      case 'corner-l':   return [{ x: -2.0, z: 0 }, { x: 0.4, z: 0 }, { x: 0.4, z: 1.8 }];
      case 'u-shape':    return [{ x: -1.6, z: 1.8 }, { x: -1.6, z: 0 }, { x: 1.6, z: 0 }, { x: 1.6, z: 1.8 }];
      case 'angled-bay': return [{ x: -2.0, z: 0 }, { x: -0.8, z: -0.5 }, { x: 0.8, z: -0.5 }, { x: 2.0, z: 0 }];
      default:           return null;
    }
  }

  function paintSketch(objectType, shape, panels, plisse, isConsultation) {
    var host = document.getElementById('cstr-photo');
    if (!host) return;
    var caption = document.getElementById('cstr-photo-cap');
    var titles = {
      terrace: 'Терраса / веранда',
      'premium-terrace': 'Премиум-терраса',
      gazebo: 'Беседка / летняя кухня',
      greenhouse: 'Теплица',
      balcony: 'Балкон / лоджия',
      horeca: 'HoReCa',
      'view-terrace': 'Терраса на крыше',
      'private-house': 'Частный дом',
      architect: 'Архитектор / девелопер'
    };
    if (caption) {
      caption.textContent = 'Архитектурный эскиз: ' + (titles[objectType] || 'объект') +
        ' с безрамным остеклением';
    }

    host.innerHTML = '';
    var svg = svgEl('svg', {
      viewBox: '0 0 600 360',
      class: 'cstr-svg' + (isConsultation ? ' is-warning' : ''),
      role: 'img',
      'aria-label': 'Эскиз проёма'
    });

    if (isConsultation || !footprintFor(shape)) {
      paintPlaceholder(svg);
    } else {
      paintProfile(svg, objectType === 'private-house', plisse, STATE.dims.heightMm);
      paintPlan(svg, shape, panels, STATE.parkingSide, plisse);
    }
    host.appendChild(svg);
  }

  function paintProfile(svg, isHouse, plisse, heightMm) {
    var GY = 250, DECK = 244, WX0 = 132, WX1 = 156, GX0 = 440, GX1 = 452;
    var t = Math.max(0, Math.min(1, ((heightMm || 800) - 800) / (3000 - 800)));
    var H = 70 + t * 80;
    var glassTop = DECK - H, roofBot = glassTop - 4, roofTop = roofBot - 10;
    var wallTop = isHouse ? (roofTop - 40) : roofTop;
    var g = svgEl('g', { class: 'pf-profile' });

    g.appendChild(svgEl('line', { x1: 56, y1: GY, x2: 544, y2: GY, class: 'pf-ink', 'stroke-width': 1.6 }));
    g.appendChild(svgEl('rect', { x: WX0, y: wallTop, width: WX1 - WX0, height: GY - wallTop, class: 'pf-alu-stroke' }));
    if (isHouse) {
      g.appendChild(svgEl('rect', { x: WX0 - 5, y: wallTop - 6, width: (WX1 - WX0) + 10, height: 6, class: 'pf-alu-stroke' }));
      g.appendChild(svgEl('rect', { x: WX0 + 5, y: wallTop + 16, width: (WX1 - WX0) - 10, height: 26, class: 'pf-alu-stroke' }));
    }
    g.appendChild(svgEl('rect', { x: WX0 + 4, y: roofTop, width: (GX1 + 12) - (WX0 + 4), height: roofBot - roofTop, class: 'pf-alu-stroke' }));
    g.appendChild(svgEl('rect', { x: WX1, y: DECK, width: GX1 - WX1, height: GY - DECK, class: 'pf-alu-stroke' }));
    g.appendChild(svgEl('rect', { x: GX0, y: roofBot, width: GX1 - GX0, height: DECK - roofBot, class: 'pf-glass' }));
    g.appendChild(svgEl('line', { x1: GX0 - 3, y1: roofBot, x2: GX1 + 3, y2: roofBot, class: 'pf-ink', 'stroke-width': 1.4 }));
    g.appendChild(svgEl('line', { x1: GX0 - 3, y1: DECK, x2: GX1 + 3, y2: DECK, class: 'pf-ink', 'stroke-width': 1.4 }));
    g.appendChild(svgEl('circle', { cx: (GX0 + GX1) / 2, cy: (roofBot + DECK) / 2, r: 2.6, class: 'pf-handle' }));
    g.appendChild(svgEl('line', { x1: 500, y1: GY, x2: 500, y2: GY - 30, class: 'pf-alu', 'stroke-width': 1 }));
    g.appendChild(svgEl('circle', { cx: 500, cy: GY - 46, r: 20, class: 'pf-alu-stroke' }));

    if (plisse) {
      for (var y = roofBot + 6; y <= DECK - 6; y += 5) {
        g.appendChild(svgEl('line', { x1: GX0 + 1, y1: y, x2: GX1 - 1, y2: y, class: 'pf-mesh' }));
      }
    }
    svg.appendChild(g);
  }

  function paintPlan(svg, shape, panels, parkingSide, plisse) {
    var fp = footprintFor(shape);
    if (!fp) return;
    var PCX = 300, PSX = 64, PY0 = 312, PSZ = 16;
    var pp = fp.map(function (p) { return { x: PCX + p.x * PSX, y: PY0 + p.z * PSZ }; });
    var g = svgEl('g', { class: 'pf-plan' });
    var t = svgEl('text', { x: 56, y: PY0 - 16, class: 'pf-lbl' });
    t.textContent = 'ПЛАН';
    g.appendChild(t);

    var pts = pp.map(function (p) { return p.x + ',' + p.y; }).join(' ');
    g.appendChild(svgEl('polyline', { points: pts, class: 'pf-plan-run' }));

    /* деления створок вдоль контура */
    var segs = [], total = 0, i;
    for (i = 1; i < pp.length; i++) {
      var dx = pp[i].x - pp[i - 1].x, dy = pp[i].y - pp[i - 1].y;
      var len = Math.hypot(dx, dy);
      segs.push({ a: pp[i - 1], dx: dx, dy: dy, len: len });
      total += len;
    }
    for (var k = 1; k < panels; k++) {
      var target = total * k / panels, acc = 0;
      for (var s = 0; s < segs.length; s++) {
        if (acc + segs[s].len >= target) {
          var tt = (target - acc) / segs[s].len;
          var sg = segs[s];
          var x = sg.a.x + sg.dx * tt, y = sg.a.y + sg.dy * tt;
          var nx = -sg.dy / sg.len, ny = sg.dx / sg.len;
          g.appendChild(svgEl('line', {
            x1: x - nx * 5, y1: y - ny * 5, x2: x + nx * 5, y2: y + ny * 5, class: 'pf-tick'
          }));
          break;
        }
        acc += segs[s].len;
      }
    }

    [pp[0], pp[pp.length - 1]].forEach(function (e) {
      g.appendChild(svgEl('rect', { x: e.x - 7, y: e.y - 7, width: 14, height: 14, class: 'pf-alu-stroke' }));
    });

    if (shape === 'straight' && parkingSide && parkingSide !== 'none') {
      var toRight = parkingSide === 'right';
      var x0 = toRight ? pp[0].x + 20 : pp[pp.length - 1].x - 20;
      var x1 = toRight ? pp[pp.length - 1].x - 14 : pp[0].x + 14;
      var ay = PY0 + 16, dir = x1 > x0 ? 1 : -1;
      g.appendChild(svgEl('line', { x1: x0, y1: ay, x2: x1, y2: ay, class: 'pf-park' }));
      g.appendChild(svgEl('path', {
        d: 'M' + x1 + ' ' + ay + ' l' + (-dir * 6) + ' -3 m' + (dir * 6) + ' 3 l' + (-dir * 6) + ' 3',
        class: 'pf-park'
      }));
    }

    if (plisse) {
      g.appendChild(svgEl('polyline', {
        points: pp.map(function (p) { return p.x + ',' + (p.y - 4); }).join(' '),
        class: 'pf-mesh-plan'
      }));
    }
    svg.appendChild(g);
  }

  function paintPlaceholder(svg) {
    var g = svgEl('g', { class: 'pf-placeholder' });
    g.appendChild(svgEl('rect', { x: 204, y: 98, width: 192, height: 140, rx: 6, class: 'pf-alu-stroke', 'stroke-width': 2 }));
    g.appendChild(svgEl('path', { d: 'M236 186 q64 -92 128 0', class: 'pf-park', 'stroke-width': 2 }));
    g.appendChild(svgEl('line', { x1: 226, y1: 212, x2: 374, y2: 212, class: 'pf-alu', 'stroke-width': 1.5 }));
    svg.appendChild(g);
  }

  /* ========================================================================
   * 4. ЗАЯВКА И ДИАЛОГИ
   * ======================================================================== */

  function wireLead() {
    var form = document.getElementById('lead-form');
    if (!form) return;
    var file = document.getElementById('ff-file');
    var fileName = document.getElementById('ff-file-name');
    if (file && fileName) {
      file.addEventListener('change', function () {
        var files = file.files;
        fileName.textContent = files && files.length
          ? Array.prototype.map.call(files, function (f) { return f.name; }).join(', ')
          : '';
      });
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var contact = form.querySelector('[name="contact"]');
      var err = form.querySelector('.field__err');
      if (contact && !contact.value.trim()) {
        contact.setAttribute('aria-invalid', 'true');
        if (err) err.hidden = false;
        contact.focus();
        return;
      }
      if (contact) contact.removeAttribute('aria-invalid');
      if (err) err.hidden = true;
      form.hidden = true;
      var ok = document.getElementById('lead-success');
      if (ok) {
        ok.hidden = false;
        ok.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  function wireDialogs() {
    $all('dialog[id]').forEach(function (dialog) {
      var canModal = typeof dialog.showModal === 'function';
      $all('[data-info-open][aria-controls="' + dialog.id + '"]').forEach(function (btn) {
        btn.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          if (canModal) dialog.showModal(); else dialog.setAttribute('open', '');
        });
      });
      dialog.addEventListener('click', function (ev) {
        var t = ev.target;
        if (t === dialog || (t.closest && t.closest('[data-info-close]'))) {
          if (canModal) dialog.close(); else dialog.removeAttribute('open');
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
