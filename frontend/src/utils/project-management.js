export const projectStatuses = {
    planning: '规划中', active: '进行中', paused: '暂停', completed: '已完成', archived: '已归档'
};

export const todoPriorities = { urgent: '紧急', high: '高', normal: '普通', low: '低' };
export const todoStages = { pending: '待处理', doing: '处理中', done: '已完成' };

function dateKey(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

export function projectCalendar(now = new Date()) {
    const monday = new Date(now);
    monday.setDate(now.getDate() - (now.getDay() + 6) % 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { today: dateKey(now), monday: dateKey(monday), sunday: dateKey(sunday) };
}

export function isOverdue(todo, today) {
    return !todo.isArchived && Boolean(todo.dueDate && todo.dueDate < today);
}

export function matchesDeadline(todo, filter, calendar) {
    if (!filter) return true;
    if (filter === 'overdue') return isOverdue(todo, calendar.today);
    if (filter === 'today') return todo.dueDate === calendar.today;
    return Boolean(todo.dueDate && todo.dueDate >= calendar.monday && todo.dueDate <= calendar.sunday);
}
