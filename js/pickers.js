/* ═══════════════════════════════════════════════════════════
   pickers.js — EqualPath Custom Date & Time Pickers
   Full-screen overlay approach for mobile
   ═══════════════════════════════════════════════════════════ */

/* ── Shared overlay ─────────────────────────────────────── */
var _pickerOverlay = null;
var _pickerBox = null;

function getPickerOverlay() {
  if (!_pickerOverlay) {
    _pickerOverlay = document.createElement('div');
    _pickerOverlay.className = 'eq-picker-overlay';
    _pickerBox = document.createElement('div');
    _pickerBox.className = 'eq-picker-box';
    _pickerOverlay.appendChild(_pickerBox);
    document.body.appendChild(_pickerOverlay);
    _pickerOverlay.addEventListener('click', function(e) {
      if (e.target === _pickerOverlay) closePickerOverlay();
    });
  }
  return { overlay: _pickerOverlay, box: _pickerBox };
}

function closePickerOverlay() {
  if (_pickerOverlay) _pickerOverlay.classList.remove('open');
}

/* ═══════════════════════════════════════════════════════════
   CALENDAR PICKER
   ═══════════════════════════════════════════════════════════ */
function EqCalendar(inputEl) {
  var self = this;
  self.input = typeof inputEl === 'string' ? gi(inputEl) : inputEl;
  self.value = null;
  self.month = new Date().getMonth();
  self.year = new Date().getFullYear();
  self.input.readOnly = true;
  self.input.style.cursor = 'pointer';

  self.input.addEventListener('click', function(e) {
    e.stopPropagation();
    self.open();
  });
}

EqCalendar.prototype.open = function() {
  var p = getPickerOverlay();
  this.render(p.box);
  p.overlay.classList.add('open');
};

EqCalendar.prototype.render = function(box) {
  var self = this;
  var today = new Date(); today.setHours(0,0,0,0);
  var months = ['Януари','Февруари','Март','Април','Май','Юни','Юли','Август','Септември','Октомври','Ноември','Декември'];
  var days = ['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];
  var first = new Date(self.year, self.month, 1);
  var startDay = (first.getDay() + 6) % 7;
  var daysInMonth = new Date(self.year, self.month + 1, 0).getDate();

  var html = '<div class="eq-cal-header">' +
    '<button type="button" class="eq-cal-nav" data-dir="-1"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg></button>' +
    '<span class="eq-cal-title">' + months[self.month] + ' ' + self.year + '</span>' +
    '<button type="button" class="eq-cal-nav" data-dir="1"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg></button>' +
    '</div><div class="eq-cal-days">';
  for (var d = 0; d < 7; d++) html += '<span class="eq-cal-day-name">' + days[d] + '</span>';
  for (var s = 0; s < startDay; s++) html += '<span class="eq-cal-empty"></span>';
  for (var i = 1; i <= daysInMonth; i++) {
    var dt = new Date(self.year, self.month, i); dt.setHours(0,0,0,0);
    var isPast = dt < today;
    var cls = 'eq-cal-day' + (isPast ? ' past' : '') + (dt.getTime() === today.getTime() ? ' today' : '') + (self.value && self.value.getTime() === dt.getTime() ? ' selected' : '');
    html += '<button type="button" class="' + cls + '" data-day="' + i + '"' + (isPast ? ' disabled' : '') + '>' + i + '</button>';
  }
  html += '</div>';
  box.innerHTML = html;

  box.querySelectorAll('.eq-cal-nav').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      self.month += parseInt(btn.dataset.dir);
      if (self.month > 11) { self.month = 0; self.year++; }
      if (self.month < 0) { self.month = 11; self.year--; }
      self.render(box);
    });
  });

  box.querySelectorAll('.eq-cal-day:not(.past)').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      self.value = new Date(self.year, self.month, parseInt(btn.dataset.day));
      var y = self.value.getFullYear(), m = String(self.value.getMonth()+1).padStart(2,'0'), dd = String(self.value.getDate()).padStart(2,'0');
      self.input.value = dd + '.' + m + '.' + y;
      self.input.dataset.isoValue = y + '-' + m + '-' + dd;
      closePickerOverlay();
    });
  });
};


/* ═══════════════════════════════════════════════════════════
   TIME PICKER — Hour then Minute grid
   ═══════════════════════════════════════════════════════════ */
function EqTimePicker(inputEl) {
  var self = this;
  self.input = typeof inputEl === 'string' ? gi(inputEl) : inputEl;
  self.hour = null;
  self.minute = null;
  self.input.readOnly = true;
  self.input.style.cursor = 'pointer';

  self.input.addEventListener('click', function(e) {
    e.stopPropagation();
    self.hour = null;
    self.open();
  });
}

EqTimePicker.prototype.open = function() {
  var p = getPickerOverlay();
  this.renderHours(p.box);
  p.overlay.classList.add('open');
};

EqTimePicker.prototype.renderHours = function(box) {
  var self = this;
  var html = '<div class="eq-time-title">Избери час</div><div class="eq-time-grid eq-time-hours">';
  for (var h = 6; h < 24; h++) {
    var hh = String(h).padStart(2, '0');
    html += '<button type="button" class="eq-time-cell" data-h="' + h + '">' + hh + '</button>';
  }
  html += '</div>';
  box.innerHTML = html;

  box.querySelectorAll('[data-h]').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      self.hour = parseInt(btn.dataset.h);
      self.renderMinutes(box);
    });
  });
};

EqTimePicker.prototype.renderMinutes = function(box) {
  var self = this;
  var hh = String(self.hour).padStart(2, '0');
  var html = '<div class="eq-time-title"><button type="button" class="eq-time-back" id="eq-time-back">←</button> ' + hh + ' : минути</div><div class="eq-time-grid eq-time-mins">';
  var mins = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
  for (var m = 0; m < mins.length; m++) {
    var mm = String(mins[m]).padStart(2, '0');
    html += '<button type="button" class="eq-time-cell" data-m="' + mins[m] + '">' + mm + '</button>';
  }
  html += '</div>';
  box.innerHTML = html;

  box.querySelectorAll('[data-m]').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      self.minute = parseInt(btn.dataset.m);
      self.input.value = String(self.hour).padStart(2,'0') + ':' + String(self.minute).padStart(2,'0');
      closePickerOverlay();
    });
  });

  var backBtn = document.getElementById('eq-time-back');
  if (backBtn) backBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    self.renderHours(box);
  });
};
