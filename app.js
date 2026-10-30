// ============================================================
// TaskFlow - Modern Todo & Task Management App
// ============================================================

(function () {
  'use strict';

  // --- State & Constants ---
  const STORAGE_KEY = 'taskflow_tasks_v1';
  const THEME_KEY = 'taskflow_theme';

  // Default initial sample tasks if storage is empty
  const INITIAL_TASKS = [
    {
      id: 'task-1',
      title: 'Welcome to TaskFlow! 🎉 Explore features & customize your workflow',
      category: 'Work',
      priority: 'high',
      dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0], // Tomorrow
      completed: false,
      createdAt: Date.now() - 3600000
    },
    {
      id: 'task-2',
      title: 'Review project presentation slides for hackathon',
      category: 'Study',
      priority: 'medium',
      dueDate: new Date().toISOString().split('T')[0], // Today
      completed: false,
      createdAt: Date.now() - 7200000
    },
    {
      id: 'task-3',
      title: 'Set up repository and push initial commit',
      category: 'Work',
      priority: 'high',
      dueDate: new Date().toISOString().split('T')[0],
      completed: true,
      createdAt: Date.now() - 10800000
    }
  ];

  let tasks = [];
  let currentStatusFilter = 'all';
  let currentCategoryFilter = 'all';
  let currentPriorityFilter = 'all';
  let currentSearchQuery = '';
  let currentSort = 'dateAddedDesc';
  let toastTimeout = null;

  // --- DOM Elements ---
  const taskForm = document.getElementById('taskForm');
  const taskInput = document.getElementById('taskInput');
  const taskCategory = document.getElementById('taskCategory');
  const taskPriority = document.getElementById('taskPriority');
  const taskDueDate = document.getElementById('taskDueDate');

  const taskList = document.getElementById('taskList');
  const emptyState = document.getElementById('emptyState');
  const emptyTitle = document.getElementById('emptyTitle');
  const emptyDescription = document.getElementById('emptyDescription');

  const totalTasksCount = document.getElementById('totalTasksCount');
  const pendingTasksCount = document.getElementById('pendingTasksCount');
  const completedTasksCount = document.getElementById('completedTasksCount');
  const progressPercent = document.getElementById('progressPercent');
  const progressBarFill = document.getElementById('progressBarFill');
  const filteredCount = document.getElementById('filteredCount');

  const statusTabs = document.getElementById('statusTabs');
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const categoryFilter = document.getElementById('categoryFilter');
  const priorityFilter = document.getElementById('priorityFilter');
  const sortBy = document.getElementById('sortBy');

  const markAllBtn = document.getElementById('markAllBtn');
  const clearCompletedBtn = document.getElementById('clearCompletedBtn');
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeIcon');
  const currentDateEl = document.getElementById('currentDate');

  // Edit Modal Elements
  const editModal = document.getElementById('editModal');
  const editTaskForm = document.getElementById('editTaskForm');
  const editTaskId = document.getElementById('editTaskId');
  const editTaskTitle = document.getElementById('editTaskTitle');
  const editTaskCategory = document.getElementById('editTaskCategory');
  const editTaskPriority = document.getElementById('editTaskPriority');
  const editTaskDueDate = document.getElementById('editTaskDueDate');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelEditBtn = document.getElementById('cancelEditBtn');

  // Toast
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toastMessage');

  // --- Initialization ---
  function init() {
    loadTheme();
    loadTasks();
    displayCurrentDate();
    attachEventListeners();
    render();
  }

  // --- Storage & State Management ---
  function loadTasks() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        tasks = JSON.parse(stored);
      } else {
        tasks = [...INITIAL_TASKS];
        saveTasks();
      }
    } catch (e) {
      console.error('Failed to load tasks from localStorage', e);
      tasks = [...INITIAL_TASKS];
    }
  }

  function saveTasks() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (e) {
      console.error('Failed to save tasks', e);
    }
  }

  // --- Theme Handling ---
  function loadTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
  }

  function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem(THEME_KEY, newTheme);
    updateThemeIcon(newTheme);
  }

  function updateThemeIcon(theme) {
    if (theme === 'dark') {
      themeIcon.className = 'fa-solid fa-sun';
      themeToggle.title = 'Switch to Light Mode';
    } else {
      themeIcon.className = 'fa-solid fa-moon';
      themeToggle.title = 'Switch to Dark Mode';
    }
  }

  function displayCurrentDate() {
    const options = { weekday: 'long', month: 'short', day: 'numeric' };
    const today = new Date().toLocaleDateString(undefined, options);
    if (currentDateEl) {
      currentDateEl.textContent = `${today} • Stay organized & productive`;
    }
  }

  // --- Task CRUD Operations ---
  function addTask(title, category, priority, dueDate) {
    const newTask = {
      id: 'task_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      title: title.trim(),
      category: category || 'Work',
      priority: priority || 'medium',
      dueDate: dueDate || '',
      completed: false,
      createdAt: Date.now()
    };

    tasks.unshift(newTask);
    saveTasks();
    render();
    showToast('Task added successfully! 🚀');
  }

  function toggleTaskCompletion(id) {
    tasks = tasks.map(task => {
      if (task.id === id) {
        const completed = !task.completed;
        return { ...task, completed };
      }
      return task;
    });
    saveTasks();
    render();
  }

  function deleteTask(id) {
    const taskToDelete = tasks.find(t => t.id === id);
    if (!taskToDelete) return;

    tasks = tasks.filter(task => task.id !== id);
    saveTasks();
    render();
    showToast('Task deleted');
  }

  function openEditModal(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    editTaskId.value = task.id;
    editTaskTitle.value = task.title;
    editTaskCategory.value = task.category;
    editTaskPriority.value = task.priority;
    editTaskDueDate.value = task.dueDate || '';

    editModal.classList.remove('hidden');
    editTaskTitle.focus();
  }

  function closeEditModal() {
    editModal.classList.add('hidden');
    editTaskForm.reset();
  }

  function saveTaskEdit(e) {
    e.preventDefault();
    const id = editTaskId.value;
    const title = editTaskTitle.value.trim();
    if (!title) return;

    tasks = tasks.map(task => {
      if (task.id === id) {
        return {
          ...task,
          title,
          category: editTaskCategory.value,
          priority: editTaskPriority.value,
          dueDate: editTaskDueDate.value
        };
      }
      return task;
    });

    saveTasks();
    closeEditModal();
    render();
    showToast('Task updated successfully! ✨');
  }

  function markAllComplete() {
    if (tasks.length === 0) return;
    const allCompleted = tasks.every(t => t.completed);
    tasks = tasks.map(t => ({ ...t, completed: !allCompleted }));
    saveTasks();
    render();
    showToast(allCompleted ? 'All marked as active' : 'All marked as completed! 🎉');
  }

  function clearCompleted() {
    const completedCount = tasks.filter(t => t.completed).length;
    if (completedCount === 0) {
      showToast('No completed tasks to clear');
      return;
    }
    tasks = tasks.filter(t => !t.completed);
    saveTasks();
    render();
    showToast(`Cleared ${completedCount} completed task${completedCount > 1 ? 's' : ''}`);
  }

  // --- Filtering & Sorting ---
  function getFilteredAndSortedTasks() {
    let result = [...tasks];

    // Status filter
    if (currentStatusFilter === 'active') {
      result = result.filter(t => !t.completed);
    } else if (currentStatusFilter === 'completed') {
      result = result.filter(t => t.completed);
    }

    // Category filter
    if (currentCategoryFilter !== 'all') {
      result = result.filter(t => t.category === currentCategoryFilter);
    }

    // Priority filter
    if (currentPriorityFilter !== 'all') {
      result = result.filter(t => t.priority === currentPriorityFilter);
    }

    // Search query
    if (currentSearchQuery.trim()) {
      const q = currentSearchQuery.toLowerCase().trim();
      result = result.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      );
    }

    // Sorting
    const priorityWeights = { high: 3, medium: 2, low: 1 };
    result.sort((a, b) => {
      if (currentSort === 'dateAddedDesc') {
        return b.createdAt - a.createdAt;
      }
      if (currentSort === 'dateAddedAsc') {
        return a.createdAt - b.createdAt;
      }
      if (currentSort === 'dueDateAsc') {
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate) - new Date(b.dueDate);
      }
      if (currentSort === 'priorityDesc') {
        return (priorityWeights[b.priority] || 0) - (priorityWeights[a.priority] || 0);
      }
      return 0;
    });

    return result;
  }

  // --- Date Formatter Helper ---
  function formatDueDate(dueDateStr) {
    if (!dueDateStr) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [year, month, day] = dueDateStr.split('-').map(Number);
    const targetDate = new Date(year, month - 1, day);
    targetDate.setHours(0, 0, 0, 0);

    const diffTime = targetDate.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return { text: `Overdue by ${Math.abs(diffDays)}d`, class: 'overdue' };
    } else if (diffDays === 0) {
      return { text: 'Due Today', class: 'today' };
    } else if (diffDays === 1) {
      return { text: 'Due Tomorrow', class: '' };
    } else {
      const formatted = targetDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      return { text: `Due ${formatted}`, class: '' };
    }
  }

  // --- Rendering UI ---
  function render() {
    renderStats();
    renderTasks();
  }

  function renderStats() {
    const total = tasks.length;
    const completed = tasks.filter(t => t.completed).length;
    const pending = total - completed;
    const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

    totalTasksCount.textContent = total;
    pendingTasksCount.textContent = pending;
    completedTasksCount.textContent = completed;
    progressPercent.textContent = `${percent}%`;
    progressBarFill.style.width = `${percent}%`;

    const allCompleted = total > 0 && completed === total;
    markAllBtn.innerHTML = allCompleted
      ? '<i class="fa-solid fa-arrow-rotate-left"></i> Uncomplete All'
      : '<i class="fa-solid fa-check"></i> Complete All';
  }

  function renderTasks() {
    const filteredTasks = getFilteredAndSortedTasks();
    filteredCount.textContent = `Showing ${filteredTasks.length} of ${tasks.length} task${tasks.length === 1 ? '' : 's'}`;

    if (filteredTasks.length === 0) {
      taskList.innerHTML = '';
      emptyState.classList.remove('hidden');

      if (tasks.length === 0) {
        emptyTitle.textContent = 'No tasks yet!';
        emptyDescription.textContent = 'Stay organized by adding your first task above.';
      } else {
        emptyTitle.textContent = 'No matching tasks';
        emptyDescription.textContent = 'Try adjusting your search terms or filter selections.';
      }
      return;
    }

    emptyState.classList.add('hidden');

    taskList.innerHTML = filteredTasks.map(task => {
      const isChecked = task.completed ? 'checked' : '';
      const completedClass = task.completed ? 'completed' : '';
      const categoryClass = `badge-${task.category.toLowerCase()}`;
      const priorityClass = `priority-${task.priority}`;
      const dueDateInfo = formatDueDate(task.dueDate);

      return `
        <li class="task-item ${completedClass}" data-id="${task.id}">
          <button 
            type="button" 
            class="custom-checkbox ${isChecked}" 
            aria-label="Toggle task completed"
            onclick="window.TaskFlow.toggleTaskCompletion('${task.id}')"
          >
            <i class="fa-solid fa-check"></i>
          </button>

          <div class="task-body">
            <span class="task-text">${escapeHtml(task.title)}</span>
            <div class="task-meta">
              <span class="badge ${categoryClass}">
                ${getCategoryIcon(task.category)} ${task.category}
              </span>
              <span class="badge ${priorityClass}">
                ${capitalize(task.priority)} Priority
              </span>
              ${dueDateInfo ? `
                <span class="due-date-badge ${dueDateInfo.class}">
                  <i class="fa-regular fa-clock"></i> ${dueDateInfo.text}
                </span>
              ` : ''}
            </div>
          </div>

          <div class="task-actions">
            <button 
              type="button" 
              class="action-icon-btn edit" 
              title="Edit task"
              onclick="window.TaskFlow.openEditModal('${task.id}')"
            >
              <i class="fa-solid fa-pencil"></i>
            </button>
            <button 
              type="button" 
              class="action-icon-btn delete" 
              title="Delete task"
              onclick="window.TaskFlow.deleteTask('${task.id}')"
            >
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </li>
      `;
    }).join('');
  }

  function getCategoryIcon(cat) {
    switch (cat) {
      case 'Work': return '<i class="fa-solid fa-briefcase"></i>';
      case 'Personal': return '<i class="fa-solid fa-house"></i>';
      case 'Study': return '<i class="fa-solid fa-book-open"></i>';
      case 'Health': return '<i class="fa-solid fa-heart-pulse"></i>';
      case 'Finance': return '<i class="fa-solid fa-wallet"></i>';
      default: return '<i class="fa-solid fa-tag"></i>';
    }
  }

  function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // --- Toast ---
  function showToast(message) {
    if (toastTimeout) clearTimeout(toastTimeout);
    toastMessage.textContent = message;
    toast.classList.remove('hidden');
    toastTimeout = setTimeout(() => {
      toast.classList.add('hidden');
    }, 2400);
  }

  // --- Event Listeners ---
  function attachEventListeners() {
    // New Task Submit
    taskForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = taskInput.value.trim();
      if (!title) return;

      addTask(title, taskCategory.value, taskPriority.value, taskDueDate.value);
      taskInput.value = '';
      taskDueDate.value = '';
      taskInput.focus();
    });

    // Theme Toggle
    themeToggle.addEventListener('click', toggleTheme);

    // Status Filter Tabs
    statusTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      statusTabs.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentStatusFilter = btn.dataset.status;
      renderTasks();
    });

    // Category Filter
    categoryFilter.addEventListener('change', (e) => {
      currentCategoryFilter = e.target.value;
      renderTasks();
    });

    // Priority Filter
    priorityFilter.addEventListener('change', (e) => {
      currentPriorityFilter = e.target.value;
      renderTasks();
    });

    // Sort Dropdown
    sortBy.addEventListener('change', (e) => {
      currentSort = e.target.value;
      renderTasks();
    });

    // Search Input
    searchInput.addEventListener('input', (e) => {
      currentSearchQuery = e.target.value;
      if (currentSearchQuery) {
        clearSearchBtn.classList.remove('hidden');
      } else {
        clearSearchBtn.classList.add('hidden');
      }
      renderTasks();
    });

    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      currentSearchQuery = '';
      clearSearchBtn.classList.add('hidden');
      searchInput.focus();
      renderTasks();
    });

    // Bulk Actions
    markAllBtn.addEventListener('click', markAllComplete);
    clearCompletedBtn.addEventListener('click', clearCompleted);

    // Modal Events
    editTaskForm.addEventListener('submit', saveTaskEdit);
    closeModalBtn.addEventListener('click', closeEditModal);
    cancelEditBtn.addEventListener('click', closeEditModal);

    editModal.addEventListener('click', (e) => {
      if (e.target === editModal) {
        closeEditModal();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !editModal.classList.contains('hidden')) {
        closeEditModal();
      }
    });
  }

  // Expose methods for inline action handlers
  window.TaskFlow = {
    toggleTaskCompletion,
    deleteTask,
    openEditModal
  };

  // Run App
  document.addEventListener('DOMContentLoaded', init);
})();
