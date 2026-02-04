// Half Marathon Training Calendar
// Training starts Feb 2, 2026 - Race day April 26, 2026

import { API_BASE } from '/utils.js';

const TRAINING_START = new Date(2026, 1, 2); // Feb 2, 2026 (Monday)
const RACE_DAY = new Date(2026, 3, 26); // April 26, 2026 (Sunday)

const TOKEN_KEY = 'dmj-auth-token';

// Training plan data - 12 weeks
const trainingPlan = [
    // Week 1 (Feb 2-8)
    {
        week: 1,
        days: [
            { day: 'Mon', workout: 'Rest', type: 'rest' },
            { day: 'Tue', workout: 'Easy 4 mi', type: 'easy' },
            { day: 'Wed', workout: 'Rest / cross-train', type: 'rest' },
            { day: 'Thu', workout: 'Tempo - 2 mi @ RP', type: 'tempo' },
            { day: 'Fri', workout: 'Rest', type: 'rest' },
            { day: 'Sat', workout: 'Easy 3 mi', type: 'easy' },
            { day: 'Sun', workout: 'Long Run - 7 mi', type: 'long' }
        ]
    },
    // Week 2 (Feb 9-15)
    {
        week: 2,
        days: [
            { day: 'Mon', workout: 'Rest', type: 'rest' },
            { day: 'Tue', workout: 'Easy 5 mi', type: 'easy' },
            { day: 'Wed', workout: 'Rest / cross-train', type: 'rest' },
            { day: 'Thu', workout: 'Tempo - 3 mi @ RP', type: 'tempo' },
            { day: 'Fri', workout: 'Rest', type: 'rest' },
            { day: 'Sat', workout: 'Easy 3-4 mi', type: 'easy' },
            { day: 'Sun', workout: 'Long Run - 8 mi', type: 'long' }
        ]
    },
    // Week 3 (Feb 16-22)
    {
        week: 3,
        days: [
            { day: 'Mon', workout: 'Rest', type: 'rest' },
            { day: 'Tue', workout: 'Easy 5 mi', type: 'easy' },
            { day: 'Wed', workout: 'Rest', type: 'rest' },
            { day: 'Thu', workout: 'Tempo - 2x1.5 mi @ RP', type: 'tempo' },
            { day: 'Fri', workout: 'Rest', type: 'rest' },
            { day: 'Sat', workout: 'Easy 4 mi', type: 'easy' },
            { day: 'Sun', workout: 'Long Run - 9 mi', type: 'long' }
        ]
    },
    // Week 4 (Feb 23 - Mar 1)
    {
        week: 4,
        days: [
            { day: 'Mon', workout: 'Rest', type: 'rest' },
            { day: 'Tue', workout: 'Easy 5 mi', type: 'easy' },
            { day: 'Wed', workout: 'Rest', type: 'rest' },
            { day: 'Thu', workout: 'Tempo - 4 mi @ RP', type: 'tempo' },
            { day: 'Fri', workout: 'Rest', type: 'rest' },
            { day: 'Sat', workout: 'Easy 4 mi', type: 'easy' },
            { day: 'Sun', workout: 'Long Run - 10 mi', type: 'long' }
        ]
    },
    // Week 5 (Mar 2-8)
    {
        week: 5,
        days: [
            { day: 'Mon', workout: 'Rest', type: 'rest' },
            { day: 'Tue', workout: 'Speed - 5x800m', type: 'speed' },
            { day: 'Wed', workout: 'Rest', type: 'rest' },
            { day: 'Thu', workout: 'Tempo - 4-5 mi @ RP', type: 'tempo' },
            { day: 'Fri', workout: 'Rest', type: 'rest' },
            { day: 'Sat', workout: 'Easy 4 mi', type: 'easy' },
            { day: 'Sun', workout: 'Long Run - 10 mi', type: 'long' }
        ]
    },
    // Week 6 (Mar 9-15)
    {
        week: 6,
        days: [
            { day: 'Mon', workout: 'Rest', type: 'rest' },
            { day: 'Tue', workout: 'Speed - 6x400m', type: 'speed' },
            { day: 'Wed', workout: 'Rest', type: 'rest' },
            { day: 'Thu', workout: 'Tempo - 5 mi @ RP', type: 'tempo' },
            { day: 'Fri', workout: 'Rest', type: 'rest' },
            { day: 'Sat', workout: 'Easy 4-5 mi', type: 'easy' },
            { day: 'Sun', workout: 'Long Run - 11 mi', type: 'long' }
        ]
    },
    // Week 7 (Mar 16-22)
    {
        week: 7,
        days: [
            { day: 'Mon', workout: 'Rest', type: 'rest' },
            { day: 'Tue', workout: 'Speed - 3x1 mi', type: 'speed' },
            { day: 'Wed', workout: 'Rest', type: 'rest' },
            { day: 'Thu', workout: 'Tempo - 6 mi progression', type: 'tempo' },
            { day: 'Fri', workout: 'Rest', type: 'rest' },
            { day: 'Sat', workout: 'Easy 4 mi', type: 'easy' },
            { day: 'Sun', workout: 'Long Run - 12 mi', type: 'long' }
        ]
    },
    // Week 8 - Recovery (Mar 23-29)
    {
        week: 8,
        label: 'Recovery',
        days: [
            { day: 'Mon', workout: 'Rest', type: 'rest' },
            { day: 'Tue', workout: 'Speed - 4x800m relaxed', type: 'speed' },
            { day: 'Wed', workout: 'Rest', type: 'rest' },
            { day: 'Thu', workout: 'Tempo - 4 mi @ RP', type: 'tempo' },
            { day: 'Fri', workout: 'Rest', type: 'rest' },
            { day: 'Sat', workout: 'Easy 4 mi', type: 'easy' },
            { day: 'Sun', workout: 'Long Run - 10 mi', type: 'long' }
        ]
    },
    // Week 9 (Mar 30 - Apr 5)
    {
        week: 9,
        days: [
            { day: 'Mon', workout: 'Rest', type: 'rest' },
            { day: 'Tue', workout: 'Hills or 6x400m', type: 'speed' },
            { day: 'Wed', workout: 'Rest', type: 'rest' },
            { day: 'Thu', workout: 'Race Pace - 6 mi @ RP', type: 'tempo' },
            { day: 'Fri', workout: 'Rest', type: 'rest' },
            { day: 'Sat', workout: 'Easy 4-5 mi', type: 'easy' },
            { day: 'Sun', workout: 'Long Run - 12 mi', type: 'long' }
        ]
    },
    // Week 10 (Apr 6-12)
    {
        week: 10,
        days: [
            { day: 'Mon', workout: 'Rest', type: 'rest' },
            { day: 'Tue', workout: 'Speed - 5x800m', type: 'speed' },
            { day: 'Wed', workout: 'Rest', type: 'rest' },
            { day: 'Thu', workout: 'Race Pace - 7 mi @ RP', type: 'tempo' },
            { day: 'Fri', workout: 'Rest', type: 'rest' },
            { day: 'Sat', workout: 'Easy 4 mi', type: 'easy' },
            { day: 'Sun', workout: 'Long Run - 12 mi', type: 'long' }
        ]
    },
    // Week 11 - Taper (Apr 13-19)
    {
        week: 11,
        label: 'Taper',
        days: [
            { day: 'Mon', workout: 'Rest', type: 'rest' },
            { day: 'Tue', workout: 'Tempo - 4-5 mi @ RP', type: 'tempo' },
            { day: 'Wed', workout: 'Rest', type: 'rest' },
            { day: 'Thu', workout: 'Easy 4 mi', type: 'easy' },
            { day: 'Fri', workout: 'Rest', type: 'rest' },
            { day: 'Sat', workout: 'Easy 3 mi', type: 'easy' },
            { day: 'Sun', workout: 'Long Run - 10 mi', type: 'long' }
        ]
    },
    // Week 12 - Race Week (Apr 20-26)
    {
        week: 12,
        label: 'Race Week',
        days: [
            { day: 'Mon', workout: 'Rest', type: 'rest' },
            { day: 'Tue', workout: '4 mi (2 mi @ RP)', type: 'easy' },
            { day: 'Wed', workout: 'Rest', type: 'rest' },
            { day: 'Thu', workout: '3 mi easy + strides', type: 'easy' },
            { day: 'Fri', workout: 'Rest', type: 'rest' },
            { day: 'Sat', workout: 'Rest / shakeout', type: 'rest' },
            { day: 'Sun', workout: 'RACE DAY', type: 'race' }
        ]
    }
];

// State
let completedWorkouts = {};
let selectedDate = null;
let selectedElement = null;
let popup = null;
let authError = false;

// Get auth token from localStorage
function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

// Load saved data from backend
async function loadData() {
    try {
        const response = await fetch(`${API_BASE}/running`);
        if (response.ok) {
            completedWorkouts = await response.json();
        }
    } catch (e) {
        console.error('Error loading saved data:', e);
    }
}

// Save data to backend
async function saveData() {
    const token = getToken();
    authError = false;

    try {
        const response = await fetch(`${API_BASE}/running`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify(completedWorkouts)
        });

        if (response.status === 401) {
            authError = true;
            return false;
        }

        return response.ok;
    } catch (e) {
        console.error('Error saving data:', e);
        return false;
    }
}

// Get training week and day info for a date
function getTrainingInfo(date) {
    const daysDiff = Math.floor((date - TRAINING_START) / (1000 * 60 * 60 * 24));

    if (daysDiff < 0 || daysDiff >= 84) return null; // Outside 12 weeks

    const weekIndex = Math.floor(daysDiff / 7);
    const dayIndex = daysDiff % 7;

    return {
        week: trainingPlan[weekIndex],
        dayInfo: trainingPlan[weekIndex].days[dayIndex],
        weekNum: weekIndex + 1,
        dayIndex
    };
}

// Format date key for storage
function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Render calendar
function renderCalendar() {
    const container = document.getElementById('calendar-container');
    container.innerHTML = '';

    // Show Feb, Mar, Apr 2026
    const months = [
        { year: 2026, month: 1, name: 'February 2026' },
        { year: 2026, month: 2, name: 'March 2026' },
        { year: 2026, month: 3, name: 'April 2026' }
    ];

    months.forEach(({ year, month, name }) => {
        const monthDiv = document.createElement('div');
        monthDiv.className = 'calendar-month';

        const h3 = document.createElement('h3');
        h3.textContent = name;
        monthDiv.appendChild(h3);

        const grid = document.createElement('div');
        grid.className = 'calendar-grid';

        // Header row
        ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(day => {
            const header = document.createElement('div');
            header.className = 'calendar-header';
            header.textContent = day;
            grid.appendChild(header);
        });

        // Get first day of month
        const firstDay = new Date(year, month, 1);
        let startDay = firstDay.getDay();
        // Adjust for Monday start (0 = Mon, 6 = Sun)
        startDay = startDay === 0 ? 6 : startDay - 1;

        // Empty cells before first day
        for (let i = 0; i < startDay; i++) {
            const empty = document.createElement('div');
            empty.className = 'calendar-day empty';
            grid.appendChild(empty);
        }

        // Days of month
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const key = dateKey(date);
            const training = getTrainingInfo(date);

            const dayDiv = document.createElement('div');
            dayDiv.className = 'calendar-day';

            if (!training) {
                dayDiv.classList.add('outside-plan');
            } else {
                dayDiv.dataset.date = key;

                if (completedWorkouts[key]) {
                    dayDiv.classList.add('completed');
                } else if (training.dayInfo.type === 'rest') {
                    dayDiv.classList.add('rest-day');
                }

                dayDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectDay(date, training, dayDiv);
                });
            }

            if (selectedDate && dateKey(selectedDate) === key) {
                dayDiv.classList.add('selected');
            }

            const numberSpan = document.createElement('span');
            numberSpan.className = 'day-number';
            numberSpan.textContent = day;
            dayDiv.appendChild(numberSpan);

            if (training) {
                const indicator = document.createElement('span');
                indicator.className = 'workout-indicator';

                if (completedWorkouts[key]) {
                    indicator.textContent = completedWorkouts[key];
                } else {
                    // Show abbreviated workout
                    const abbrev = abbreviateWorkout(training.dayInfo.workout);
                    indicator.textContent = abbrev;
                }
                dayDiv.appendChild(indicator);
            }

            grid.appendChild(dayDiv);
        }

        monthDiv.appendChild(grid);
        container.appendChild(monthDiv);
    });
}

// Abbreviate workout for calendar display
function abbreviateWorkout(workout) {
    if (workout === 'Rest' || workout === 'Rest / cross-train' || workout === 'Rest / shakeout') return 'Rest';
    if (workout.includes('Long Run')) return 'Long';
    if (workout.includes('Easy')) return 'Easy';
    if (workout.includes('Tempo') || workout.includes('Race Pace')) return 'Tempo';
    if (workout.includes('Speed') || workout.includes('Hills') || workout.includes('x')) return 'Speed';
    if (workout === 'RACE DAY') return 'RACE';
    return workout.substring(0, 5);
}

// Close popup
function closePopup() {
    if (popup) {
        popup.remove();
        popup = null;
    }
    selectedDate = null;
    selectedElement = null;
    // Remove selected class from all days
    document.querySelectorAll('.calendar-day.selected').forEach(el => {
        el.classList.remove('selected');
    });
}

// Select a day
function selectDay(date, training, element) {
    // If clicking the same day, close popup
    if (selectedDate && dateKey(selectedDate) === dateKey(date)) {
        closePopup();
        return;
    }

    closePopup();

    selectedDate = date;
    selectedElement = element;
    element.classList.add('selected');

    showPopup(date, training, element);
}

// Show popup below selected day
function showPopup(date, training, element) {
    const key = dateKey(date);
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    popup = document.createElement('div');
    popup.className = 'workout-popup';

    // Header with day info
    const header = document.createElement('div');
    header.className = 'popup-header';
    header.innerHTML = `
        <div class="popup-title">${dayName}</div>
        <div class="popup-planned">Plan: ${training.dayInfo.workout}</div>
        ${completedWorkouts[key] ? `<div class="popup-logged">Logged: ${completedWorkouts[key]}</div>` : ''}
    `;
    popup.appendChild(header);

    // Workout options
    const optionsDiv = document.createElement('div');
    optionsDiv.className = 'popup-options';

    const workoutTypes = [
        { label: 'Rest', short: 'Rest' },
        { label: 'Easy', short: 'Easy' },
        { label: 'Tempo', short: 'Tempo' },
        { label: 'Speed', short: 'Speed' },
        { label: 'Long', short: 'Long' },
        { label: 'XT', short: 'XT' }
    ];

    if (training.dayInfo.type === 'race') {
        workoutTypes.push({ label: 'RACE', short: 'RACE' });
    }

    // Auth error message container
    const authErrorDiv = document.createElement('div');
    authErrorDiv.className = 'popup-auth-error';
    authErrorDiv.style.display = 'none';
    authErrorDiv.textContent = 'Login required to save changes';

    workoutTypes.forEach(({ label, short }) => {
        const btn = document.createElement('button');
        btn.className = 'popup-btn';
        if (completedWorkouts[key] === short) btn.classList.add('selected');

        btn.textContent = label;
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const oldValue = completedWorkouts[key];
            completedWorkouts[key] = short;
            const success = await saveData();
            if (!success && authError) {
                // Revert change and show auth error
                if (oldValue) {
                    completedWorkouts[key] = oldValue;
                } else {
                    delete completedWorkouts[key];
                }
                authErrorDiv.style.display = 'block';
                return;
            }
            closePopup();
            renderCalendar();
        });
        optionsDiv.appendChild(btn);
    });

    popup.appendChild(optionsDiv);
    popup.appendChild(authErrorDiv);

    // Clear button if logged
    if (completedWorkouts[key]) {
        const clearBtn = document.createElement('button');
        clearBtn.className = 'popup-clear';
        clearBtn.textContent = 'Clear';
        clearBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const oldValue = completedWorkouts[key];
            delete completedWorkouts[key];
            const success = await saveData();
            if (!success && authError) {
                // Revert change and show auth error
                completedWorkouts[key] = oldValue;
                authErrorDiv.style.display = 'block';
                return;
            }
            closePopup();
            renderCalendar();
        });
        popup.appendChild(clearBtn);
    }

    // Position popup below the element
    document.body.appendChild(popup);

    const rect = element.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();

    let left = rect.left + (rect.width / 2) - (popupRect.width / 2);
    let top = rect.bottom + 8;

    // Keep within viewport
    if (left < 8) left = 8;
    if (left + popupRect.width > window.innerWidth - 8) {
        left = window.innerWidth - popupRect.width - 8;
    }

    // If popup would go below viewport, show above instead
    if (top + popupRect.height > window.innerHeight - 8) {
        top = rect.top - popupRect.height - 8;
    }

    popup.style.left = `${left + window.scrollX}px`;
    popup.style.top = `${top + window.scrollY}px`;
}

// Render plan reference
function renderPlanReference() {
    const container = document.getElementById('plan-reference');

    let html = '';
    trainingPlan.forEach(week => {
        html += `<div class="week-plan">
            <h4>Week ${week.week}${week.label ? ' - ' + week.label : ''}</h4>
            <ul>
                ${week.days.map(d => `<li><strong>${d.day}:</strong> ${d.workout}</li>`).join('')}
            </ul>
        </div>`;
    });

    container.innerHTML = html;
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    renderCalendar();
    renderPlanReference();

    // Close popup when clicking outside
    document.addEventListener('click', (e) => {
        if (popup && !popup.contains(e.target) && !e.target.closest('.calendar-day')) {
            closePopup();
        }
    });

    // Close popup on escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closePopup();
        }
    });
});
