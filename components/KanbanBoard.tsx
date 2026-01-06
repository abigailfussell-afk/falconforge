import React, { useState, useRef, useEffect } from 'react';
import { Task, TaskStatus, TaskType, Member, Team, TimelineEvent } from '../types';
import { STATUS_COLUMNS } from '../constants';
import { Plus, Calendar as CalendarIcon, List, Layout, Clock, Send, Trash2, ChevronDown, ChevronRight, X, Archive, RotateCcw } from 'lucide-react';
import { useCurrentUser } from '../src/lib/user-context';

interface KanbanBoardProps {
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  members: Member[];
  teams: Team[];
}

const KanbanBoard: React.FC<KanbanBoardProps> = ({ tasks, setTasks, members, teams }) => {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isNewTask, setIsNewTask] = useState(false);
  const [view, setView] = useState<'board' | 'list' | 'calendar' | 'archived'>('board');
  const [newComment, setNewComment] = useState('');
  const [collapsedColumns, setCollapsedColumns] = useState<Record<string, boolean>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const newChecklistRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Get current logged-in user for comments
  const { currentUser, displayName, initials: userInitials } = useCurrentUser();

  // Auto-focus title input when creating new task
  useEffect(() => {
    if (isModalOpen && isNewTask && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isModalOpen, isNewTask]);

  const getMemberName = (id: string) => {
    const m = members.find(mem => mem.id === id);
    return m ? `${m.firstName} ${m.lastNameInitial}.` : 'Unassigned';
  };

  const getTeamName = (id: string) => {
    const t = teams.find(team => team.id === id);
    return t ? t.name : 'General';
  };

  const getInitials = (id: string) => {
    const m = members.find(mem => mem.id === id);
    return m ? `${m.firstName[0]}${m.lastNameInitial}` : '?';
  };

  const openTask = (task: Task) => {
    setActiveTask(task);
    setIsNewTask(false);
    setIsModalOpen(true);
  };

  const createNewTask = () => {
    const newTask: Task = {
      id: Date.now().toString(),
      title: 'New Task',
      description: '',
      status: TaskStatus.Backlog,
      type: TaskType.Feature,
      assignedTo: members[0]?.id || '',
      department: teams[0]?.id || '',
      tags: [],
      checklist: [],
      timeline: [],
      createdAt: Date.now()
    };
    setActiveTask(newTask);
    setIsNewTask(true);
    setIsModalOpen(true);
  };

  const saveTask = () => {
    if (!activeTask) return;

    const originalTask = tasks.find(t => t.id === activeTask.id);
    let updatedTask = { ...activeTask };

    if (!isNewTask && originalTask && originalTask.status !== activeTask.status) {
      const statusEvent: TimelineEvent = {
        id: Date.now().toString(),
        type: 'history',
        authorId: currentUser?.id || 'System',
        content: `moved to ${activeTask.status}`,
        timestamp: Date.now()
      };
      updatedTask.timeline = [statusEvent, ...updatedTask.timeline];
    }

    if (isNewTask) {
      setTasks([...tasks, updatedTask]);
    } else {
      setTasks(tasks.map(t => t.id === updatedTask.id ? updatedTask : t));
    }
    setIsModalOpen(false);
  };

  const addComment = () => {
    if (!newComment.trim() || !activeTask) return;
    const comment: TimelineEvent = {
      id: Date.now().toString(),
      type: 'comment',
      authorId: currentUser?.id || 'guest',
      content: newComment,
      timestamp: Date.now()
    };
    const updatedTask = {
      ...activeTask,
      timeline: [comment, ...activeTask.timeline]
    };
    setActiveTask(updatedTask);
    // Save comment immediately
    if (isNewTask) {
      setTasks([...tasks.filter(t => t.id !== activeTask.id), updatedTask]);
    } else {
      setTasks(tasks.map(t => t.id === updatedTask.id ? updatedTask : t));
    }
    setNewComment('');
  };

  const deleteComment = (commentId: string) => {
    if (!activeTask) return;
    const updatedTask = {
      ...activeTask,
      timeline: activeTask.timeline.filter(t => t.id !== commentId)
    };
    setActiveTask(updatedTask);
    // Save deletion immediately
    if (!isNewTask) {
      setTasks(tasks.map(t => t.id === updatedTask.id ? updatedTask : t));
    }
  };

  const deleteTask = (id: string) => {
    setTasks(tasks.filter(t => t.id !== id));
    setDeleteConfirmId(null);
    setIsModalOpen(false);
  };

  const archiveTask = () => {
    if (!activeTask) return;
    const archivedTask = {
      ...activeTask,
      status: TaskStatus.Archived as TaskStatus,
      archivedAt: Date.now()
    };
    setTasks(tasks.map(t => t.id === archivedTask.id ? archivedTask : t));
    setIsModalOpen(false);
  };

  const restoreTask = (id: string) => {
    setTasks(tasks.map(t => t.id === id ? { ...t, status: TaskStatus.Done as TaskStatus, archivedAt: undefined } : t));
  };




  const toggleColumn = (status: string) => {
    setCollapsedColumns(prev => ({
      ...prev,
      [status]: !prev[status]
    }));
  }

  // Views Components
  const BoardView = () => (
    <div className="flex flex-col md:flex-row gap-4 h-full md:pb-4 overflow-y-auto md:overflow-x-auto">
      {STATUS_COLUMNS.map(status => {
        const isCollapsed = collapsedColumns[status];
        return (
          <div
            key={status}
            className={`bg-slate-100 dark:bg-slate-800 rounded-xl flex flex-col flex-shrink-0 transition-all ${isCollapsed ? 'md:w-12 h-auto' : 'md:w-[280px] md:h-full'}`}
          >
            <div
              className="p-3 font-semibold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center cursor-pointer md:cursor-default"
              onClick={() => { if (window.innerWidth < 768) toggleColumn(status); }}
            >
              <div className="flex items-center gap-2">
                {/* Mobile chevron */}
                <span className="md:hidden">
                  {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                </span>
                <span className={isCollapsed ? "md:hidden" : ""}>{status}</span>
              </div>
              <span className="bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs px-2 py-1 rounded-full">
                {tasks.filter(t => t.status === status).length}
              </span>
            </div>

            <div className={`flex-1 overflow-y-auto p-2 space-y-2 transition-all ${isCollapsed ? 'hidden' : 'block'} min-h-[50px] md:min-h-0`}>
              {tasks.filter(t => t.status === status).map(task => (
                <div
                  key={task.id}
                  onClick={() => openTask(task)}
                  className="bg-white dark:bg-slate-700 p-3 rounded-lg shadow-sm border border-slate-200 dark:border-slate-600 cursor-pointer hover:shadow-md transition group relative"
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${task.type === TaskType.Bug ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}>
                      {task.type}
                    </span>
                    <div className="text-xs text-slate-400 dark:text-slate-500">{new Date(task.createdAt).toLocaleDateString()}</div>
                  </div>
                  <h4 className="font-medium text-slate-800 dark:text-slate-200 mb-1">{task.title || 'Untitled'}</h4>
                  <div className="flex items-center gap-2 mt-3 text-xs text-slate-500 dark:text-slate-400">
                    <span className="bg-slate-100 dark:bg-slate-600 px-1.5 py-0.5 rounded">{getTeamName(task.department)}</span>
                    {task.dueDate && <span className="flex items-center gap-1 text-orange-600 dark:text-orange-400"><Clock size={10} />{new Date(task.dueDate).toLocaleDateString()}</span>}
                    <div className="flex-1"></div>
                    {task.assignedTo && (
                      <div className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-400 flex items-center justify-center font-bold text-[10px] border border-orange-200 dark:border-orange-800">
                        {getInitials(task.assignedTo)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  const ListView = () => (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-x-auto">
      <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-[600px]">
        <thead className="bg-slate-50 dark:bg-slate-700 text-xs uppercase font-bold text-slate-500 dark:text-slate-400">
          <tr>
            <th className="p-4">Title</th>
            <th className="p-4">Type</th>
            <th className="p-4">Status</th>
            <th className="p-4">Assigned</th>
            <th className="p-4">Due Date</th>
            <th className="p-4">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
          {tasks.map(task => (
            <tr key={task.id} onClick={() => openTask(task)} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition">
              <td className="p-4 font-medium text-slate-900 dark:text-white">{task.title || 'Untitled'}</td>
              <td className="p-4"><span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${task.type === TaskType.Bug ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}>{task.type}</span></td>
              <td className="p-4">{task.status}</td>
              <td className="p-4">{getMemberName(task.assignedTo)}</td>
              <td className="p-4">{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '-'}</td>
              <td className="p-4 text-slate-400">{new Date(task.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const CalendarView = () => {
    const tasksByDate = tasks
      .filter(t => t.dueDate)
      .sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));

    return (
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 overflow-y-auto">
        <h3 className="font-bold text-lg mb-4 text-slate-800 dark:text-white">Upcoming Deadlines</h3>
        {tasksByDate.length === 0 ? (
          <div className="text-center text-slate-400 py-10">No tasks with due dates found.</div>
        ) : (
          <div className="space-y-6">
            {tasksByDate.map(task => (
              <div key={task.id} onClick={() => openTask(task)} className="flex items-center gap-4 p-4 border border-slate-100 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition">
                <div className="bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 p-3 rounded-lg flex flex-col items-center min-w-[60px]">
                  <span className="text-xs uppercase font-bold">{new Date(task.dueDate!).toLocaleString('default', { month: 'short' })}</span>
                  <span className="text-xl font-bold">{new Date(task.dueDate!).getDate()}</span>
                </div>
                <div className="flex-1">
                  <h4 className="font-bold text-slate-800 dark:text-white">{task.title}</h4>
                  <div className="flex gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
                    <span className="bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">{task.status}</span>
                    <span>•</span>
                    <span>{getMemberName(task.assignedTo)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const ArchivedView = () => {
    const archivedTasks = tasks
      .filter(t => t.status === TaskStatus.Archived)
      .sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));

    return (
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 overflow-y-auto">
        <h3 className="font-bold text-lg mb-4 text-slate-800 dark:text-white flex items-center gap-2">
          <Archive size={20} className="text-slate-500" />
          Archived Tasks
        </h3>
        {archivedTasks.length === 0 ? (
          <div className="text-center text-slate-400 py-10">No archived tasks yet. Complete tasks and archive them when done.</div>
        ) : (
          <div className="space-y-3">
            {archivedTasks.map(task => (
              <div
                key={task.id}
                className="flex items-center gap-4 p-4 border border-slate-100 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-700/30 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition"
                onClick={() => openTask(task)}
              >
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-slate-800 dark:text-white truncate">{task.title}</h4>
                  <div className="flex gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
                    <span className="bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">{getTeamName(task.department)}</span>
                    <span>•</span>
                    <span>{getMemberName(task.assignedTo)}</span>
                    {task.archivedAt && (
                      <>
                        <span>•</span>
                        <span>Archived {new Date(task.archivedAt).toLocaleDateString()}</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); restoreTask(task.id); }}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-orange-600 dark:text-orange-400 border border-orange-300 dark:border-orange-700 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-900/20 transition"
                >
                  <RotateCcw size={14} />
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-col md:flex-row justify-between items-center mb-3 md:mb-4 px-2 md:px-4 gap-3 md:gap-4">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-white self-start md:self-auto">Sprint Planning</h2>

        <div className="flex flex-row items-center gap-3 w-full md:w-auto">
          <div className="flex items-center gap-1 bg-slate-200 dark:bg-slate-700 p-1 rounded-lg">
            <button onClick={() => setView('board')} className={`p-2 rounded-md transition flex items-center justify-center ${view === 'board' ? 'bg-white dark:bg-slate-600 shadow text-orange-600 dark:text-orange-400' : 'text-slate-500 dark:text-slate-400'}`} title="Board"><Layout size={18} /></button>
            <button onClick={() => setView('list')} className={`p-2 rounded-md transition flex items-center justify-center ${view === 'list' ? 'bg-white dark:bg-slate-600 shadow text-orange-600 dark:text-orange-400' : 'text-slate-500 dark:text-slate-400'}`} title="List"><List size={18} /></button>
            <button onClick={() => setView('calendar')} className={`p-2 rounded-md transition flex items-center justify-center ${view === 'calendar' ? 'bg-white dark:bg-slate-600 shadow text-orange-600 dark:text-orange-400' : 'text-slate-500 dark:text-slate-400'}`} title="Calendar"><CalendarIcon size={18} /></button>
            <button onClick={() => setView('archived')} className={`p-2 rounded-md transition flex items-center justify-center ${view === 'archived' ? 'bg-white dark:bg-slate-600 shadow text-orange-600 dark:text-orange-400' : 'text-slate-500 dark:text-slate-400'}`} title="Archived"><Archive size={18} /></button>
          </div>

          <button
            onClick={createNewTask}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 transition"
          >
            <Plus size={20} /> <span className="hidden md:inline">New Item</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden px-2 md:px-4">
        {view === 'board' && <BoardView />}
        {view === 'list' && <ListView />}
        {view === 'calendar' && <CalendarView />}
        {view === 'archived' && <ArchivedView />}
      </div>

      {isModalOpen && activeTask && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50">
              <div className="flex-1 mr-4">
                <input
                  ref={titleInputRef}
                  value={activeTask.title}
                  onChange={(e) => setActiveTask({ ...activeTask, title: e.target.value })}
                  placeholder="Task Title"
                  className="text-xl font-bold bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-600 rounded-lg p-2 focus:ring-2 focus:ring-orange-500 w-full placeholder-slate-400 dark:placeholder-slate-500 text-slate-900 dark:text-white"
                />
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-700 p-2 rounded-full flex items-center justify-center w-8 h-8">
                <span className="sr-only">Close</span>
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Type</label>
                  <select
                    value={activeTask.type}
                    onChange={(e) => setActiveTask({ ...activeTask, type: e.target.value as TaskType })}
                    className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                  >
                    <option value={TaskType.Feature}>Feature</option>
                    <option value={TaskType.Bug}>Bug</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Status</label>
                  <select
                    value={activeTask.status}
                    onChange={(e) => setActiveTask({ ...activeTask, status: e.target.value as TaskStatus })}
                    className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                  >
                    {STATUS_COLUMNS.map(s => <option key={s} value={s}>{s}</option>)}
                    {activeTask.status === TaskStatus.Archived && (
                      <option value={TaskStatus.Archived}>Archived</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Team</label>
                  <select
                    value={activeTask.department}
                    onChange={(e) => setActiveTask({ ...activeTask, department: e.target.value })}
                    className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                  >
                    {teams.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Assigned To</label>
                  <select
                    value={activeTask.assignedTo}
                    onChange={(e) => setActiveTask({ ...activeTask, assignedTo: e.target.value })}
                    className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                  >
                    <option value="">Unassigned</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.firstName} {m.lastNameInitial}.</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={activeTask.dueDate ? new Date(activeTask.dueDate).toISOString().substr(0, 10) : ''}
                    onChange={(e) => setActiveTask({ ...activeTask, dueDate: e.target.valueAsNumber })}
                    className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Description / Notes</label>
                <textarea
                  value={activeTask.description}
                  onChange={(e) => setActiveTask({ ...activeTask, description: e.target.value })}
                  className="w-full h-32 p-3 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  placeholder="Describe the task, paste meeting minutes, or log bug details..."
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Checklist</label>
                <div className="space-y-2">
                  {activeTask.checklist.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={item.completed}
                        onChange={(e) => {
                          const newChecklist = [...activeTask.checklist];
                          newChecklist[idx].completed = e.target.checked;
                          setActiveTask({ ...activeTask, checklist: newChecklist });
                        }}
                        className="rounded text-orange-600 focus:ring-orange-500"
                      />
                      <input
                        ref={idx === activeTask.checklist.length - 1 ? newChecklistRef : null}
                        type="text"
                        value={item.text}
                        placeholder="Enter checklist item..."
                        onChange={(e) => {
                          const newChecklist = [...activeTask.checklist];
                          newChecklist[idx].text = e.target.value;
                          setActiveTask({ ...activeTask, checklist: newChecklist });
                        }}
                        className="flex-1 text-sm border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 rounded px-2 py-1 focus:ring-1 focus:ring-orange-500 text-slate-900 dark:text-white placeholder-slate-400"
                      />
                      <button
                        onClick={() => {
                          const newChecklist = activeTask.checklist.filter((_, i) => i !== idx);
                          setActiveTask({ ...activeTask, checklist: newChecklist });
                        }}
                        className="text-slate-400 hover:text-red-500 border border-slate-300 dark:border-slate-600 hover:border-red-400 rounded p-1 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      setActiveTask({ ...activeTask, checklist: [...activeTask.checklist, { id: Date.now().toString(), text: '', completed: false }] });
                      setTimeout(() => {
                        newChecklistRef.current?.focus();
                      }, 50);
                    }}
                    className="text-sm text-orange-600 dark:text-orange-400 font-medium hover:underline"
                  >
                    + Add Checklist Item
                  </button>
                </div>
              </div>

              <div className="border-t border-slate-100 dark:border-slate-700 pt-6">
                <h3 className="font-bold text-slate-800 dark:text-white mb-4">Activity & Comments</h3>

                <div className="flex gap-2 mb-6">
                  <input
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Add a comment..."
                    className="flex-1 border rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white"
                    onKeyDown={(e) => e.key === 'Enter' && addComment()}
                  />
                  <button onClick={addComment} className="bg-orange-600 text-white p-2 rounded-lg hover:bg-orange-700">
                    <Send size={18} />
                  </button>
                </div>

                <div className="space-y-4">
                  {activeTask.timeline.map((event) => {
                    // Check if author is the current logged-in user or a roster member
                    const isCurrentUser = currentUser && event.authorId === currentUser.id;
                    const isSystem = event.authorId === 'System';
                    const isMember = !isCurrentUser && !isSystem && members.find(m => m.id === event.authorId);

                    // Determine display name and initials
                    const authorName = isSystem
                      ? 'System'
                      : isCurrentUser
                        ? displayName
                        : isMember
                          ? getMemberName(event.authorId)
                          : 'Guest';
                    const authorInitials = isSystem
                      ? 'S'
                      : isCurrentUser
                        ? userInitials
                        : isMember
                          ? getInitials(event.authorId)
                          : 'G';

                    return (
                      <div key={event.id} className="flex gap-3 text-sm">
                        <div className="mt-1 w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center text-xs font-bold text-slate-600 dark:text-slate-300 flex-shrink-0">
                          {authorInitials}
                        </div>
                        <div className="flex-1 bg-slate-50 dark:bg-slate-700/50 p-3 rounded-r-lg rounded-bl-lg">
                          <div className="flex justify-between items-start mb-1">
                            <span className="font-bold text-slate-700 dark:text-slate-200">
                              {authorName}
                            </span>
                            <span className="text-xs text-slate-400">{new Date(event.timestamp).toLocaleDateString()}</span>
                          </div>
                          <div className={event.type === 'history' ? 'italic text-slate-500' : 'text-slate-800 dark:text-slate-300'}>
                            {event.content}
                          </div>
                          {event.type === 'comment' && (
                            <div className="flex justify-end mt-1">
                              <button onClick={() => deleteComment(event.id)} className="text-xs text-red-400 hover:text-red-600 flex items-center gap-1">
                                <Trash2 size={10} /> Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-700 flex justify-between bg-slate-50 dark:bg-slate-900/50">
              <div className="flex gap-2">
                {!isNewTask && (
                  <button
                    onClick={() => setDeleteConfirmId(activeTask.id)}
                    className="px-3 py-2 rounded-lg text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium flex items-center gap-1 transition"
                  >
                    <Trash2 size={16} />
                    Delete
                  </button>
                )}
                {!isNewTask && activeTask.status === TaskStatus.Done && (
                  <button
                    onClick={archiveTask}
                    className="px-3 py-2 rounded-lg text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 font-medium flex items-center gap-1 transition"
                  >
                    <Archive size={16} />
                    Archive
                  </button>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={saveTask}
                  className="px-6 py-2 rounded-lg bg-orange-600 text-white font-medium hover:bg-orange-700 shadow-sm"
                >
                  Save Task
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Delete Task?</h3>
            <p className="text-slate-600 dark:text-slate-300 mb-6">
              This task will be permanently deleted. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteTask(deleteConfirmId)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KanbanBoard;