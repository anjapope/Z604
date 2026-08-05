const prevMonthButton = document.getElementById('prevMonth');
const nextMonthButton = document.getElementById('nextMonth');
const monthTitle = document.getElementById('monthTitle');
const monthSummary = document.getElementById('monthSummary');
const monthGrid = document.getElementById('monthGrid');

const monthNameFormatter = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
let currentMonthDate = new Date();
currentMonthDate = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth(), 1);

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftMonth(delta) {
  currentMonthDate = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() + delta, 1);
  renderCurrentMonth();
}

function asLocalDate(year, monthIndex, day) {
  return new Date(year, monthIndex, day, 12, 0, 0, 0);
}

function getDaysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function getDatesByWeekday(year, monthIndex, weekday) {
  const dates = [];
  const totalDays = getDaysInMonth(year, monthIndex);

  for (let day = 1; day <= totalDays; day += 1) {
    const date = asLocalDate(year, monthIndex, day);
    if (date.getDay() === weekday) {
      dates.push(date);
    }
  }

  return dates;
}

function getNthWeekdayOfMonth(year, monthIndex, weekday, nth) {
  const matches = getDatesByWeekday(year, monthIndex, weekday);
  return matches[nth - 1] || null;
}

function getMonsterPromDate(year) {
  const halloween = asLocalDate(year, 9, 31);
  let date = new Date(halloween);
  do {
    date = asLocalDate(date.getFullYear(), date.getMonth(), date.getDate() - 1);
  } while (date.getDay() !== 6);
  return date;
}

function buildMonthlyEvents(year, monthIndex) {
  const events = [];
  const tuesdays = getDatesByWeekday(year, monthIndex, 2);
  const fridays = getDatesByWeekday(year, monthIndex, 5);
  const mondays = getDatesByWeekday(year, monthIndex, 1);
  const wednesdays = getDatesByWeekday(year, monthIndex, 3);
  const saturdays = getDatesByWeekday(year, monthIndex, 6);
  const fourthThursday = getNthWeekdayOfMonth(year, monthIndex, 4, 4);

  tuesdays.forEach((date) => {
    events.push({
      date,
      title: 'Storytime',
      time: '10:00-11:00 AM',
      details: 'Weekly storytime for children and families.'
    });
  });

  fridays.forEach((date) => {
    events.push({
      date,
      title: 'Storytime',
      time: '10:00-11:00 AM',
      details: 'Weekly storytime for children and families.'
    });
  });

  mondays.forEach((date) => {
    events.push({
      date,
      title: 'Tech Team Training Seminars',
      time: '11:00 AM',
      details: '3D printing and digital tools training; open to the public.'
    });
  });

  wednesdays.forEach((date) => {
    events.push({
      date,
      title: 'Adult Book Club',
      time: '6:30 PM',
      details: 'Adult Services fiction-focused discussion group.'
    });
  });

  fridays.forEach((date) => {
    events.push({
      date,
      title: 'Fiction Convention Showcase',
      time: '6:30 PM',
      details: 'Adult Services showcase event for fiction fans.'
    });
  });

  saturdays.forEach((date) => {
    events.push({
      date,
      title: 'Teen Game and Craft Days/Tournaments',
      time: '12:00-4:00 PM',
      details: 'Youth Services weekend games, crafts, and tournaments.'
    });
  });

  if (fourthThursday) {
    events.push({
      date: fourthThursday,
      title: 'Lego Lab',
      time: '5:30-7:30 PM',
      details: 'For families, kids, and enthusiasts.'
    });

    events.push({
      date: fourthThursday,
      title: 'Board Meeting',
      time: '8:00 PM',
      details: 'Open to the public.'
    });
  }

  if (monthIndex % 2 === 0) {
    tuesdays.forEach((date) => {
      events.push({
        date,
        title: 'Digital Citizenship Workshop',
        time: '7:30 PM',
        details: 'All ages; offered every Tuesday in alternating months.'
      });
    });
  }

  if (monthIndex === 5 || monthIndex === 6) {
    events.push({
      date: asLocalDate(year, monthIndex, 1),
      title: 'Summer Reading Program',
      time: 'All day',
      details: 'Runs June 1-July 31. Participants win prizes; families can sign up in BeanStack.'
    });
  }

  if (monthIndex === 8 || monthIndex === 9 || monthIndex === 10) {
    events.push({
      date: asLocalDate(year, monthIndex, 1),
      title: 'Frontiers and Folktales',
      time: 'Seasonal program',
      details: 'Partnership between Youth Services, Special Collections, and Mercer Park featuring oral regional folktales.'
    });
  }

  if (monthIndex === 9) {
    events.push({
      date: getMonsterPromDate(year),
      title: 'Youth Services Monster Prom',
      time: '8:00-10:30 PM',
      details: 'Held on the weekend before Halloween.'
    });
  }

  return events.sort((left, right) => {
    const leftTime = left.date.getTime();
    const rightTime = right.date.getTime();
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.time.localeCompare(right.time);
  });
}

function groupEventsByDate(events) {
  const eventMap = new Map();
  events.forEach((event) => {
    const key = toDateKey(event.date);
    if (!eventMap.has(key)) {
      eventMap.set(key, []);
    }
    eventMap.get(key).push(event);
  });
  return eventMap;
}

function renderCurrentMonth() {
  const year = currentMonthDate.getFullYear();
  const monthIndex = currentMonthDate.getMonth();
  const events = buildMonthlyEvents(year, monthIndex);
  const eventMap = groupEventsByDate(events);
  const heading = monthNameFormatter.format(asLocalDate(year, monthIndex, 1));

  monthTitle.textContent = heading;
  monthSummary.textContent = `${heading}: ${events.length} scheduled items`;
  monthGrid.innerHTML = '';

  const firstDayOfMonth = asLocalDate(year, monthIndex, 1);
  const firstWeekday = firstDayOfMonth.getDay();
  const daysInMonth = getDaysInMonth(year, monthIndex);
  const daysInPreviousMonth = getDaysInMonth(year, monthIndex - 1);

  for (let cellIndex = 0; cellIndex < 42; cellIndex += 1) {
    let cellDate;

    if (cellIndex < firstWeekday) {
      const day = daysInPreviousMonth - firstWeekday + cellIndex + 1;
      cellDate = asLocalDate(year, monthIndex - 1, day);
    } else if (cellIndex >= firstWeekday + daysInMonth) {
      const day = cellIndex - (firstWeekday + daysInMonth) + 1;
      cellDate = asLocalDate(year, monthIndex + 1, day);
    } else {
      const day = cellIndex - firstWeekday + 1;
      cellDate = asLocalDate(year, monthIndex, day);
    }

    const dayCell = document.createElement('article');
    dayCell.className = 'day-cell';

    if (cellDate.getMonth() !== monthIndex) {
      dayCell.classList.add('outside-month');
    }

    dayCell.innerHTML = `<p class="day-number">${cellDate.getDate()}</p>`;

    const dateKey = toDateKey(cellDate);
    const dayEvents = eventMap.get(dateKey) || [];

    if (dayEvents.length) {
      const eventList = document.createElement('ul');
      eventList.className = 'day-events';

      dayEvents.forEach((event) => {
        const item = document.createElement('li');
        item.innerHTML = `<strong>${event.time}</strong> ${event.title}`;
        item.title = `${event.title} — ${event.details}`;
        eventList.appendChild(item);
      });

      dayCell.appendChild(eventList);
    }

    monthGrid.appendChild(dayCell);
  }
}

prevMonthButton.addEventListener('click', () => shiftMonth(-1));
nextMonthButton.addEventListener('click', () => shiftMonth(1));
renderCurrentMonth();
