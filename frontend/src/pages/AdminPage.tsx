/**
 * Admin page for user and feedback management
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import * as adminService from '../services/adminService';
import type { AdminUserResponse } from '../types/api';
import type { AdminFeedback, FeedbackStats, FeedbackStatus, FeedbackType, AdminSharedEnvironment } from '../services/adminService';
import {
  Users,
  UserPlus,
  Shield,
  ShieldOff,
  Trash2,
  Key,
  Check,
  X,
  AlertCircle,
  RefreshCw,
  LogOut,
  Home,
  MessageSquare,
  Bug,
  Lightbulb,
  HelpCircle,
  Eye,
  EyeOff,
  CheckCircle,
  XCircle,
  Package,
  Search,
  TrendingUp,
  Download,
  Heart,
} from 'lucide-react';
import { cn } from '../lib/utils';

type AdminTab = 'users' | 'feedback' | 'environments';

export function AdminPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  // Tab state
  const [activeTab, setActiveTab] = useState<AdminTab>('users');

  // Users state
  const [users, setUsers] = useState<AdminUserResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Feedback state
  const [feedbacks, setFeedbacks] = useState<AdminFeedback[]>([]);
  const [feedbackStats, setFeedbackStats] = useState<FeedbackStats | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackFilter, setFeedbackFilter] = useState<{ status?: FeedbackStatus; type?: FeedbackType }>({});
  const [showDeleteFeedbackConfirm, setShowDeleteFeedbackConfirm] = useState<string | null>(null);

  // Environments state
  const [environments, setEnvironments] = useState<AdminSharedEnvironment[]>([]);
  const [envPagination, setEnvPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [envLoading, setEnvLoading] = useState(false);
  const [envSearch, setEnvSearch] = useState('');
  const [envStatusFilter, setEnvStatusFilter] = useState<'active' | 'withdrawn' | 'all'>('all');
  const [showDeleteEnvConfirm, setShowDeleteEnvConfirm] = useState<string | null>(null);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  // Form states
  const [newUser, setNewUser] = useState({ email: '', username: '', password: '', isAdmin: false });
  const [newPassword, setNewPassword] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await adminService.listUsers();
      setUsers(data);
    } catch (err: any) {
      setError(err.message || 'Errore nel caricamento degli utenti');
    } finally {
      setLoading(false);
    }
  };

  const loadFeedbacks = async () => {
    try {
      setFeedbackLoading(true);
      const [data, stats] = await Promise.all([
        adminService.listFeedbacks(feedbackFilter),
        adminService.getFeedbackStats(),
      ]);
      setFeedbacks(data);
      setFeedbackStats(stats);
    } catch (err: any) {
      setError(err.message || 'Errore nel caricamento dei feedback');
    } finally {
      setFeedbackLoading(false);
    }
  };

  const loadEnvironments = async (page = 1) => {
    try {
      setEnvLoading(true);
      const response = await adminService.listSharedEnvironments({
        page,
        limit: 20,
        status: envStatusFilter,
        search: envSearch || undefined,
      });
      setEnvironments(response.data);
      setEnvPagination({
        page: response.pagination.page,
        pages: response.pagination.pages,
        total: response.pagination.total,
      });
    } catch (err: any) {
      setError(err.message || 'Errore nel caricamento degli ambienti');
    } finally {
      setEnvLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
    loadFeedbacks();
  }, []);

  useEffect(() => {
    if (activeTab === 'feedback') {
      loadFeedbacks();
    }
  }, [feedbackFilter]);

  useEffect(() => {
    if (activeTab === 'environments') {
      loadEnvironments(1);
    }
  }, [activeTab, envStatusFilter]);

  // Environment handlers
  const handleWithdrawEnv = async (id: string) => {
    try {
      setActionLoading(true);
      await adminService.withdrawSharedEnvironment(id);
      setEnvironments(prev => prev.map(e => e.id === id ? { ...e, isActive: false } : e));
    } catch (err: any) {
      setError(err.message || 'Errore nel ritirare l\'ambiente');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRepublishEnv = async (id: string) => {
    try {
      setActionLoading(true);
      await adminService.republishSharedEnvironment(id);
      setEnvironments(prev => prev.map(e => e.id === id ? { ...e, isActive: true } : e));
    } catch (err: any) {
      setError(err.message || 'Errore nel ripubblicare l\'ambiente');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteEnv = async () => {
    if (!showDeleteEnvConfirm) return;
    try {
      setActionLoading(true);
      await adminService.deleteSharedEnvironment(showDeleteEnvConfirm);
      setEnvironments(prev => prev.filter(e => e.id !== showDeleteEnvConfirm));
      setShowDeleteEnvConfirm(null);
    } catch (err: any) {
      setError(err.message || 'Errore nell\'eliminazione dell\'ambiente');
    } finally {
      setActionLoading(false);
    }
  };

  const handleEnvSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadEnvironments(1);
  };

  const handleUpdateFeedbackStatus = async (id: string, status: FeedbackStatus) => {
    try {
      setActionLoading(true);
      await adminService.updateFeedbackStatus(id, status);
      await loadFeedbacks();
    } catch (err: any) {
      setError(err.message || 'Errore nell\'aggiornamento');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteFeedback = async () => {
    if (!showDeleteFeedbackConfirm) return;
    try {
      setActionLoading(true);
      await adminService.deleteFeedback(showDeleteFeedbackConfirm);
      setShowDeleteFeedbackConfirm(null);
      await loadFeedbacks();
    } catch (err: any) {
      setError(err.message || 'Errore nell\'eliminazione');
    } finally {
      setActionLoading(false);
    }
  };

  const getFeedbackTypeIcon = (type: FeedbackType) => {
    switch (type) {
      case 'bug': return <Bug size={16} className="text-red-500" />;
      case 'suggestion': return <Lightbulb size={16} className="text-amber-500" />;
      default: return <HelpCircle size={16} className="text-blue-500" />;
    }
  };

  const getFeedbackStatusBadge = (status: FeedbackStatus) => {
    const styles = {
      new: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      read: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
      resolved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      dismissed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    };
    const labels = { new: 'Nuovo', read: 'Letto', resolved: 'Risolto', dismissed: 'Ignorato' };
    return (
      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', styles[status])}>
        {labels[status]}
      </span>
    );
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setActionLoading(true);
      setActionError(null);
      await adminService.createUser(newUser);
      setNewUser({ email: '', username: '', password: '', isAdmin: false });
      setShowCreateModal(false);
      await loadUsers();
    } catch (err: any) {
      setActionError(err.message || 'Errore nella creazione utente');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleAdmin = async (userId: string, currentIsAdmin: boolean) => {
    try {
      setActionLoading(true);
      await adminService.updateUser(userId, { isAdmin: !currentIsAdmin });
      await loadUsers();
    } catch (err: any) {
      setError(err.message || 'Errore nell\'aggiornamento');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleActive = async (userId: string, currentIsActive: boolean) => {
    try {
      setActionLoading(true);
      await adminService.updateUser(userId, { isActive: !currentIsActive });
      await loadUsers();
    } catch (err: any) {
      setError(err.message || 'Errore nell\'aggiornamento');
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!showResetPasswordModal || !newPassword) return;
    try {
      setActionLoading(true);
      setActionError(null);
      await adminService.resetPassword(showResetPasswordModal, { newPassword });
      setNewPassword('');
      setShowResetPasswordModal(null);
    } catch (err: any) {
      setActionError(err.message || 'Errore nel reset password');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!showDeleteConfirm) return;
    try {
      setActionLoading(true);
      await adminService.deleteUser(showDeleteConfirm);
      setShowDeleteConfirm(null);
      await loadUsers();
    } catch (err: any) {
      setError(err.message || 'Errore nell\'eliminazione');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 text-amber-600 rounded-lg flex items-center justify-center">
                  <Shield size={20} />
                </div>
                <div>
                  <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Admin Panel</h1>
                  <p className="text-xs text-gray-500">VisuaLex</p>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700/50 rounded-lg p-1">
                <button
                  onClick={() => setActiveTab('users')}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                    activeTab === 'users'
                      ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  )}
                >
                  <Users size={16} />
                  Utenti
                </button>
                <button
                  onClick={() => setActiveTab('feedback')}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors relative',
                    activeTab === 'feedback'
                      ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  )}
                >
                  <MessageSquare size={16} />
                  Feedback
                  {feedbackStats && feedbackStats.new > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                      {feedbackStats.new}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('environments')}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                    activeTab === 'environments'
                      ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                  )}
                >
                  <Package size={16} />
                  Ambienti
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3 relative z-50">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {user?.email}
              </span>
              <button
                onClick={() => navigate('/')}
                className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors pointer-events-auto"
                title="Torna all'app"
              >
                <Home size={20} />
              </button>
              <button
                onClick={logout}
                className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors pointer-events-auto"
                title="Logout"
              >
                <LogOut size={20} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 isolate">
        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3">
            <AlertCircle className="text-red-500" size={20} />
            <p className="text-red-600 dark:text-red-400">{error}</p>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
              <X size={18} />
            </button>
          </div>
        )}

        {/* ==================== USERS TAB ==================== */}
        {activeTab === 'users' && (
          <>
            {/* Actions Bar */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Users size={20} className="text-gray-500" />
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                    Utenti ({users.length})
                  </h2>
                </div>
                {/* Pending users badge */}
                {users.filter(u => !u.is_active).length > 0 && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full text-sm font-medium">
                    <AlertCircle size={14} />
                    {users.filter(u => !u.is_active).length} in attesa di approvazione
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={loadUsers}
                  disabled={loading}
                  className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
                  title="Aggiorna"
                >
                  <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                </button>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                >
                  <UserPlus size={18} />
                  Nuovo Utente
                </button>
              </div>
            </div>

            {/* Users Table */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              {loading && users.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
                  Caricamento utenti...
                </div>
              ) : users.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  Nessun utente trovato
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-700/50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Utente
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Stato
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Ruolo
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Attività
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Creato
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Azioni
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {users.map((u) => (
                        <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                          <td className="px-6 py-4">
                            <div>
                              <p className="font-medium text-gray-900 dark:text-white">{u.username}</p>
                              <p className="text-sm text-gray-500">{u.email}</p>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <button
                              onClick={() => handleToggleActive(u.id, u.is_active)}
                              disabled={u.id === user?.id}
                              className={cn(
                                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                                u.is_active
                                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                  : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                                u.id === user?.id ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80 cursor-pointer'
                              )}
                            >
                              {u.is_active ? <Check size={12} /> : <X size={12} />}
                              {u.is_active ? 'Attivo' : 'Disattivo'}
                            </button>
                          </td>
                          <td className="px-6 py-4">
                            <button
                              onClick={() => handleToggleAdmin(u.id, u.is_admin)}
                              disabled={u.id === user?.id}
                              className={cn(
                                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                                u.is_admin
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
                                u.id === user?.id ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80 cursor-pointer'
                              )}
                            >
                              {u.is_admin ? <Shield size={12} /> : <ShieldOff size={12} />}
                              {u.is_admin ? 'Admin' : 'Utente'}
                            </button>
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                              <p className="font-medium text-gray-700 dark:text-gray-300">
                                {u.login_count ?? 0} accessi
                              </p>
                              {u.last_login_at && (
                                <p>Ultimo: {new Date(u.last_login_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
                              )}
                              {u.stats && (
                                <p className="text-gray-400">{u.stats.bookmarks} bookmarks</p>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                            {new Date(u.created_at).toLocaleDateString('it-IT')}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => setShowResetPasswordModal(u.id)}
                                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                title="Reset password"
                              >
                                <Key size={16} />
                              </button>
                              <button
                                onClick={() => setShowDeleteConfirm(u.id)}
                                disabled={u.id === user?.id}
                                className={cn(
                                  'p-2 rounded-lg transition-colors',
                                  u.id === user?.id
                                    ? 'text-gray-300 cursor-not-allowed'
                                    : 'text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20'
                                )}
                                title="Elimina utente"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ==================== FEEDBACK TAB ==================== */}
        {activeTab === 'feedback' && (
          <>
            {/* Actions Bar */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <MessageSquare size={20} className="text-gray-500" />
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                    Feedback ({feedbacks.length})
                  </h2>
                </div>
                {feedbackStats && (
                  <div className="flex items-center gap-3 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      <Bug size={14} className="text-red-500" />
                      {feedbackStats.bugs} bug
                    </span>
                    <span className="flex items-center gap-1">
                      <Lightbulb size={14} className="text-amber-500" />
                      {feedbackStats.suggestions} suggerimenti
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Filters */}
                <select
                  value={feedbackFilter.status || ''}
                  onChange={(e) => setFeedbackFilter({ ...feedbackFilter, status: e.target.value as FeedbackStatus || undefined })}
                  className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">Tutti gli stati</option>
                  <option value="new">Nuovo</option>
                  <option value="read">Letto</option>
                  <option value="resolved">Risolto</option>
                  <option value="dismissed">Ignorato</option>
                </select>
                <select
                  value={feedbackFilter.type || ''}
                  onChange={(e) => setFeedbackFilter({ ...feedbackFilter, type: e.target.value as FeedbackType || undefined })}
                  className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">Tutti i tipi</option>
                  <option value="bug">Bug</option>
                  <option value="suggestion">Suggerimento</option>
                  <option value="other">Altro</option>
                </select>
                <button
                  onClick={loadFeedbacks}
                  disabled={feedbackLoading}
                  className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
                  title="Aggiorna"
                >
                  <RefreshCw size={20} className={feedbackLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* Feedback List */}
            <div className="space-y-4">
              {feedbackLoading && feedbacks.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-xl p-8 text-center text-gray-500 border border-gray-200 dark:border-gray-700">
                  <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
                  Caricamento feedback...
                </div>
              ) : feedbacks.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-xl p-8 text-center text-gray-500 border border-gray-200 dark:border-gray-700">
                  <MessageSquare size={32} className="mx-auto mb-2 opacity-50" />
                  Nessun feedback trovato
                </div>
              ) : (
                feedbacks.map((f) => (
                  <div
                    key={f.id}
                    className={cn(
                      'bg-white dark:bg-gray-800 rounded-xl border p-4 transition-colors',
                      f.status === 'new'
                        ? 'border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10'
                        : 'border-gray-200 dark:border-gray-700'
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          {getFeedbackTypeIcon(f.type)}
                          <span className="text-sm font-medium text-gray-900 dark:text-white capitalize">
                            {f.type === 'bug' ? 'Bug' : f.type === 'suggestion' ? 'Suggerimento' : 'Altro'}
                          </span>
                          {getFeedbackStatusBadge(f.status)}
                          <span className="text-xs text-gray-400">
                            {new Date(f.created_at).toLocaleString('it-IT')}
                          </span>
                        </div>
                        <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                          {f.message}
                        </p>
                        <p className="mt-2 text-xs text-gray-500">
                          Da: <span className="font-medium">{f.user.username}</span> ({f.user.email})
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {f.status === 'new' && (
                          <button
                            onClick={() => handleUpdateFeedbackStatus(f.id, 'read')}
                            disabled={actionLoading}
                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                            title="Segna come letto"
                          >
                            <Eye size={16} />
                          </button>
                        )}
                        {f.status !== 'resolved' && (
                          <button
                            onClick={() => handleUpdateFeedbackStatus(f.id, 'resolved')}
                            disabled={actionLoading}
                            className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                            title="Segna come risolto"
                          >
                            <CheckCircle size={16} />
                          </button>
                        )}
                        {f.status !== 'dismissed' && (
                          <button
                            onClick={() => handleUpdateFeedbackStatus(f.id, 'dismissed')}
                            disabled={actionLoading}
                            className="p-2 text-gray-400 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-lg transition-colors"
                            title="Ignora"
                          >
                            <XCircle size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => setShowDeleteFeedbackConfirm(f.id)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                          title="Elimina"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {/* ==================== ENVIRONMENTS TAB ==================== */}
        {activeTab === 'environments' && (
          <>
            {/* Actions Bar */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Package size={20} className="text-gray-500" />
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                    Ambienti Pubblicati ({envPagination.total})
                  </h2>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Search */}
                <form onSubmit={handleEnvSearch} className="flex items-center gap-2">
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={envSearch}
                      onChange={(e) => setEnvSearch(e.target.value)}
                      placeholder="Cerca ambiente..."
                      className="pl-9 pr-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none w-64"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm"
                  >
                    Cerca
                  </button>
                </form>
                {/* Status Filter */}
                <select
                  value={envStatusFilter}
                  onChange={(e) => setEnvStatusFilter(e.target.value as 'active' | 'withdrawn' | 'all')}
                  className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="all">Tutti</option>
                  <option value="active">Attivi</option>
                  <option value="withdrawn">Ritirati</option>
                </select>
                <button
                  onClick={() => loadEnvironments(envPagination.page)}
                  disabled={envLoading}
                  className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
                  title="Aggiorna"
                >
                  <RefreshCw size={20} className={envLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* Environments Table */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              {envLoading && environments.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
                  Caricamento ambienti...
                </div>
              ) : environments.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <Package size={32} className="mx-auto mb-2 opacity-50" />
                  Nessun ambiente trovato
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 dark:bg-gray-700/50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Ambiente
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Autore
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Stato
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Statistiche
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Creato
                          </th>
                          <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Azioni
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {environments.map((env) => (
                          <tr key={env.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                            <td className="px-6 py-4">
                              <div>
                                <p className="font-medium text-gray-900 dark:text-white">
                                  {env.title}
                                </p>
                                <p className="text-sm text-gray-500 truncate max-w-xs">
                                  {env.description || 'Nessuna descrizione'}
                                </p>
                                <div className="flex items-center gap-1 mt-1">
                                  <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded">
                                    {env.category}
                                  </span>
                                  <span className="text-xs text-gray-400">v{env.currentVersion}</span>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="text-sm">
                                <p className="font-medium text-gray-900 dark:text-white">{env.user.username}</p>
                                <p className="text-gray-500">{env.user.email}</p>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
                                env.isActive
                                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                              )}>
                                {env.isActive ? <Eye size={12} /> : <EyeOff size={12} />}
                                {env.isActive ? 'Attivo' : 'Ritirato'}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3 text-xs text-gray-500">
                                <span className="flex items-center gap-1" title="Visualizzazioni">
                                  <TrendingUp size={12} />
                                  {env.viewCount}
                                </span>
                                <span className="flex items-center gap-1" title="Download">
                                  <Download size={12} />
                                  {env.downloadCount}
                                </span>
                                <span className="flex items-center gap-1" title="Like">
                                  <Heart size={12} />
                                  {env.likeCount}
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                              {new Date(env.createdAt).toLocaleDateString('it-IT')}
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex items-center justify-end gap-1">
                                {env.isActive ? (
                                  <button
                                    onClick={() => handleWithdrawEnv(env.id)}
                                    disabled={actionLoading}
                                    className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors"
                                    title="Ritira"
                                  >
                                    <EyeOff size={16} />
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleRepublishEnv(env.id)}
                                    disabled={actionLoading}
                                    className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                                    title="Ripubblica"
                                  >
                                    <Eye size={16} />
                                  </button>
                                )}
                                <button
                                  onClick={() => setShowDeleteEnvConfirm(env.id)}
                                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                  title="Elimina"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {envPagination.pages > 1 && (
                    <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700">
                      <p className="text-sm text-gray-500">
                        Pagina {envPagination.page} di {envPagination.pages} ({envPagination.total} ambienti)
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => loadEnvironments(envPagination.page - 1)}
                          disabled={envPagination.page <= 1 || envLoading}
                          className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Precedente
                        </button>
                        <button
                          onClick={() => loadEnvironments(envPagination.page + 1)}
                          disabled={envPagination.page >= envPagination.pages || envLoading}
                          className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Successiva
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </main>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Crea Nuovo Utente
            </h3>
            {actionError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
                {actionError}
              </div>
            )}
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Username
                </label>
                <input
                  type="text"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  required
                  minLength={3}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  required
                  minLength={3}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isAdmin"
                  checked={newUser.isAdmin}
                  onChange={(e) => setNewUser({ ...newUser, isAdmin: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                />
                <label htmlFor="isAdmin" className="text-sm text-gray-700 dark:text-gray-300">
                  Amministratore
                </label>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setActionError(null);
                    setNewUser({ email: '', username: '', password: '', isAdmin: false });
                  }}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {actionLoading ? 'Creazione...' : 'Crea Utente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showResetPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Reset Password
            </h3>
            {actionError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
                {actionError}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Nuova Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  minLength={3}
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowResetPasswordModal(null);
                    setActionError(null);
                    setNewPassword('');
                  }}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Annulla
                </button>
                <button
                  onClick={handleResetPassword}
                  disabled={actionLoading || !newPassword}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {actionLoading ? 'Reset...' : 'Reset Password'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="text-center">
              <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 size={24} />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Conferma Eliminazione
              </h3>
              <p className="text-gray-500 dark:text-gray-400 mb-6">
                Sei sicuro di voler eliminare questo utente? Tutti i suoi dati verranno eliminati permanentemente.
              </p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(null)}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Annulla
                </button>
                <button
                  onClick={handleDeleteUser}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {actionLoading ? 'Eliminazione...' : 'Elimina'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Feedback Confirmation Modal */}
      {showDeleteFeedbackConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="text-center">
              <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 size={24} />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Elimina Feedback
              </h3>
              <p className="text-gray-500 dark:text-gray-400 mb-6">
                Sei sicuro di voler eliminare questo feedback? L'azione non può essere annullata.
              </p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={() => setShowDeleteFeedbackConfirm(null)}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Annulla
                </button>
                <button
                  onClick={handleDeleteFeedback}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {actionLoading ? 'Eliminazione...' : 'Elimina'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Environment Confirmation Modal */}
      {showDeleteEnvConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="text-center">
              <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 size={24} />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Elimina Ambiente
              </h3>
              <p className="text-gray-500 dark:text-gray-400 mb-6">
                Sei sicuro di voler eliminare questo ambiente? L'azione eliminerà permanentemente l'ambiente e tutte le sue versioni.
              </p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={() => setShowDeleteEnvConfirm(null)}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Annulla
                </button>
                <button
                  onClick={handleDeleteEnv}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {actionLoading ? 'Eliminazione...' : 'Elimina'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
