/* ═══════════════════════════════════════════════════════════
   pickers.js — EqualPath Custom Date & Time Pickers
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   CUSTOM CALENDAR PICKER
   ═══════════════════════════════════════════════════════════ */
function EqCalendar(inputEl) {
  var self = this;
  self.input = typeof inputEl === 'string' ? gi(inputEl) : inputEl;
  self.value = null;
  self.month = new Date().getMonth();
  self.year = new Date().getFullYear();
  self.container = document.createElement('div');
  self.container.className = 'eq-cal';
  self.input.parentElement.style.position = 'relative';
  self.input.parentElement.appendChild(self.container);
  self.input.readOnly = true;
  self.input.style.cursor = 'pointer';

  self.input.addEventListener('click', function(e) {
    e.stopPropagation();
    if (self.container.classList.contains('open')) { self.close(); return; }
    document.querySelectorAll('.eq-cal.open,.eq-time.open').forEach(function(el) { el.classList.remove('open'); });
    self.render();
    self.container.classList.add('open');
  });
  document.addEventListener('click', function(e) {
    if (!self.container.contains(e.target) && e.target !== self.input) self.close();
  });
}

EqCalendar.prototype.close = function() { this.container.classList.remove('open'); };

EqCalendar.prototype.render = function() {
  var self = this;
  var today = new Date(); today.setHours(0,0,0,0);
  var months = ['Януари','Февруари','Март','Април','Май','Юни','Юли','Август','Септември','Октомври','Ноември','Декември'];
  var days = ['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];
  var first = new Date(self.year, self.month, 1);
  var startDay = (first.getDay() + 6) % 7;
  var daysInMonth = new Date(self.year, self.month + 1, 0).getDate();

  var html = '<div class="eq-cal-header">' +
    '<button type="button" class="eq-cal-nav" data-dir="-1"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg></button>' +
    '<span class="eq-cal-title">' + months[self.month] + ' ' + self.year + '</span>' +
    '<button type="button" class="eq-cal-nav" data-dir="1"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg></button>' +
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
  self.container.innerHTML = html;

  self.container.querySelectorAll('.eq-cal-nav').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      self.month += parseInt(btn.dataset.dir);
      if (self.month > 11) { self.month = 0; self.year++; }
      if (self.month < 0) { self.month = 11; self.year--; }
      self.render();
    });
  });

  self.container.querySelectorAll('.eq-cal-day:not(.past)').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      self.value = new Date(self.year, self.month, parseInt(btn.dataset.day));
      var y = self.value.getFullYear(), m = String(self.value.getMonth()+1).padStart(2,'0'), dd = String(self.value.getDate()).padStart(2,'0');
      self.input.value = dd + '.' + m + '.' + y;
      self.input.dataset.isoValue = y + '-' + m + '-' + dd;
      self.close();
    });
  });
};


/* ═══════════════════════════════════════════════════════════
   CUSTOM TIME PICKER — Hour + Minute grid
   ═══════════════════════════════════════════════════════════ */
function EqTimePicker(inputEl) {
  var self = this;
  self.input = typeof inputEl === 'string' ? gi(inputEl) : inputEl;
  self.hour = null;
  self.minute = null;
  self.step = 'hour'; // 'hour' or 'minute'
  self.container = document.createElement('div');
  self.container.className = 'eq-time';
  self.input.parentElement.style.position = 'relative';
  self.input.parentElement.appendChild(self.container);
  self.input.readOnly = true;
  self.input.style.cursor = 'pointer';

  self.input.addEventListener('click', function(e) {
    e.stopPropagation();
    if (self.container.classList.contains('open')) { self.close(); return; }
    document.querySelectorAll('.eq-cal.open,.eq-time.open').forEach(function(el) { el.classList.remove('open'); });
    self.step = 'hour';
    self.render();
    self.container.classList.add('open');
  });
  document.addEventListener('click', function(e) {
    if (!self.container.contains(e.target) && e.target !== self.input) self.close();
  });
}

EqTimePicker.prototype.close = function() { this.container.classList.remove('open'); };

EqTimePicker.prototype.render = function() {
  var self = this;
  var html = '';

  if (self.step === 'hour') {
    html = '<div class="eq-time-title">Избери час</div><div class="eq-time-grid eq-time-hours">';
    for (var h = 6; h < 24; h++) {
      var hh = String(h).padStart(2, '0');
      var cls = 'eq-time-cell' + (self.hour === h ? ' selected' : '');
      html += '<button type="button" class="' + cls + '" data-h="' + h + '">' + hh + '</button>';
    }
    html += '</div>';
  } else {
    var hh = String(self.hour).padStart(2, '0');
    html = '<div class="eq-time-title"><button type="button" class="eq-time-back" id="eq-time-back">← </button> ' + hh + ' : избери минути</div><div class="eq-time-grid eq-time-mins">';
    var mins = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
    for (var m = 0; m < mins.length; m++) {
      var mm = String(mins[m]).padStart(2, '0');
      var cls = 'eq-time-cell' + (self.minute === mins[m] ? ' selected' : '');
      html += '<button type="button" class="' + cls + '" data-m="' + mins[m] + '">' + mm + '</button>';
    }
    html += '</div>';
  }

  self.container.innerHTML = html;

  if (self.step === 'hour') {
    self.container.querySelectorAll('[data-h]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        self.hour = parseInt(btn.dataset.h);
        self.step = 'minute';
        self.render();
      });
    });
  } else {
    self.container.querySelectorAll('[data-m]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        self.minute = parseInt(btn.dataset.m);
        var hh = String(self.hour).padStart(2, '0');
        var mm = String(self.minute).padStart(2, '0');
        self.input.value = hh + ':' + mm;
        self.close();
      });
    });
    var backBtn = gi('eq-time-back');
    if (backBtn) backBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      self.step = 'hour';
      self.render();
    });
  }
};
