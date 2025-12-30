import { useState, useEffect } from 'react';
import { X, Monitor, Moon, Sun, Eye, HelpCircle, Shield, Info, GitBranch, GitCommit, Tag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { useAuth } from '../../hooks/useAuth';
import { cn } from '../../lib/utils';
import { Z_INDEX } from '../../constants/zIndex';

interface CommitInfo {
    hash: string;
    message: string;
    date: string;
    author: string;
}

interface VersionInfo {
    version: string;
    git: {
        branch: string;
        commit: {
            hash: string;
            hash_full: string;
            message: string;
            date: string;
            author: string;
        };
    };
    changelog: CommitInfo[];
}

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onRestartTour?: () => void;
}

export function SettingsModal({ isOpen, onClose, onRestartTour }: SettingsModalProps) {
    const navigate = useNavigate();
    const { isAdmin } = useAuth();
    const { settings, updateSettings, openAliasManager, customAliases } = useAppStore();
    const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
    const [versionLoading, setVersionLoading] = useState(false);
    const [versionError, setVersionError] = useState(false);
    const [showInfo, setShowInfo] = useState(false);

    useEffect(() => {
        if (isOpen && !versionInfo && !versionLoading && !versionError) {
            setVersionLoading(true);
            fetch('/version', { signal: AbortSignal.timeout(5000) })
                .then(res => {
                    if (!res.ok) throw new Error('Failed to fetch version');
                    return res.json();
                })
                .then(data => {
                    setVersionInfo(data);
                    setVersionError(false);
                })
                .catch(() => {
                    setVersionError(true);
                    setVersionInfo(null);
                })
                .finally(() => setVersionLoading(false));
        }
    }, [isOpen, versionInfo, versionLoading, versionError]);

    if (!isOpen) return null;

    const formatDate = (dateStr: string) => {
        if (!dateStr || dateStr === 'unknown') return 'N/D';
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString('it-IT', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return dateStr;
        }
    };

    return (
        <div className={cn("fixed inset-0 flex items-center justify-center p-4", Z_INDEX.settings)}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-md" onClick={onClose} />
            <div className="relative bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-2xl shadow-glass-lg w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-white/20 dark:border-white/10">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 dark:border-white/5 bg-white/20 dark:bg-white/5">
                    <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        Impostazioni
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                    {/* Theme - iOS-style Segmented Control */}
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase mb-3 block">Tema</label>
                        <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-xl grid grid-cols-2 gap-1">
                            <button
                                onClick={() => updateSettings({ theme: 'light' })}
                                className={cn(
                                    "flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all",
                                    settings.theme === 'light'
                                        ? "bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400"
                                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                                )}
                            >
                                <Sun size={16} /> Chiaro
                            </button>
                            <button
                                onClick={() => updateSettings({ theme: 'dark' })}
                                className={cn(
                                    "flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all",
                                    settings.theme === 'dark'
                                        ? "bg-white dark:bg-slate-700 shadow-sm text-blue-600 dark:text-blue-400"
                                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                                )}
                            >
                                <Moon size={16} /> Scuro
                            </button>
                            <button
                                onClick={() => updateSettings({ theme: 'sepia' })}
                                className={cn(
                                    "flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all",
                                    settings.theme === 'sepia'
                                        ? "bg-white dark:bg-slate-700 shadow-sm text-amber-600 dark:text-amber-400"
                                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                                )}
                            >
                                <Eye size={16} /> Seppia
                            </button>
                            <button
                                onClick={() => updateSettings({ theme: 'high-contrast' })}
                                className={cn(
                                    "flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all",
                                    settings.theme === 'high-contrast'
                                        ? "bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white"
                                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                                )}
                            >
                                <Monitor size={16} /> Contrasto
                            </button>
                        </div>
                    </div>

                    {/* Typography */}
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase mb-3 block">Tipografia</label>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800 p-2 rounded-lg">
                                <span className="text-sm text-slate-600 dark:text-slate-400 px-2">Dimensione</span>
                                <div className="flex gap-1">
                                    {(['small', 'medium', 'large', 'xlarge'] as const).map(size => (
                                        <button
                                            key={size}
                                            onClick={() => updateSettings({ fontSize: size })}
                                            className={`w-8 h-8 flex items-center justify-center rounded text-sm font-bold transition-colors ${settings.fontSize === size ? 'bg-blue-600 text-white' : 'hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'}`}
                                            title={size}
                                        >
                                            {size === 'small' ? 'A' : size === 'medium' ? 'A+' : size === 'large' ? 'A++' : 'A#'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800 p-2 rounded-lg">
                                <span className="text-sm text-slate-600 dark:text-slate-400 px-2">Font</span>
                                <div className="flex gap-1">
                                    <button
                                        onClick={() => updateSettings({ fontFamily: 'sans' })}
                                        className={`px-3 py-1.5 rounded text-xs font-sans border ${settings.fontFamily === 'sans' ? 'border-blue-500 bg-white dark:bg-slate-700 text-blue-600' : 'border-transparent hover:bg-slate-200'}`}
                                    >Sans</button>
                                    <button
                                        onClick={() => updateSettings({ fontFamily: 'serif' })}
                                        className={`px-3 py-1.5 rounded text-xs font-serif border ${settings.fontFamily === 'serif' ? 'border-blue-500 bg-white dark:bg-slate-700 text-blue-600' : 'border-transparent hover:bg-slate-200'}`}
                                    >Serif</button>
                                    <button
                                        onClick={() => updateSettings({ fontFamily: 'mono' })}
                                        className={`px-3 py-1.5 rounded text-xs font-mono border ${settings.fontFamily === 'mono' ? 'border-blue-500 bg-white dark:bg-slate-700 text-blue-600' : 'border-transparent hover:bg-slate-200'}`}
                                    >Mono</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Custom Aliases */}
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase mb-3 block">Alias Personalizzati</label>
                        <button
                            onClick={() => {
                                onClose();
                                setTimeout(() => openAliasManager(), 200);
                            }}
                            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors text-sm font-medium"
                        >
                            <Tag size={16} />
                            Gestisci Alias ({customAliases.length})
                        </button>
                    </div>

                    {/* Restart Tour */}
                    {onRestartTour && (
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase mb-3 block">Aiuto</label>
                            <button
                                onClick={() => {
                                    onClose();
                                    // Small delay to let modal close animation complete
                                    setTimeout(() => onRestartTour(), 200);
                                }}
                                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors text-sm font-medium"
                            >
                                <HelpCircle size={16} />
                                Ricomincia il Tour Guidato
                            </button>
                        </div>
                    )}

                    {/* Admin Panel - only for admins */}
                    {isAdmin && (
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase mb-3 block">Amministrazione</label>
                            <button
                                onClick={() => {
                                    onClose();
                                    navigate('/admin');
                                }}
                                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors text-sm font-medium"
                            >
                                <Shield size={16} />
                                Pannello Admin
                            </button>
                        </div>
                    )}

                    {/* Version Info */}
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase mb-3 block">Informazioni</label>
                        <button
                            onClick={() => setShowInfo(!showInfo)}
                            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-sm font-medium"
                        >
                            <Info size={16} />
                            {showInfo
                                ? 'Nascondi dettagli'
                                : versionLoading
                                    ? 'Caricamento...'
                                    : versionError
                                        ? 'Versione (errore)'
                                        : `Versione ${versionInfo?.version || '1.0.0'}`
                            }
                        </button>

                        {showInfo && versionInfo && (
                            <div className="mt-3 space-y-3">
                                {/* Version & Git Info */}
                                <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl space-y-2 text-xs">
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-500">Versione</span>
                                        <span className="font-mono font-medium text-blue-600 dark:text-blue-400">
                                            v{versionInfo.version}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-500 flex items-center gap-1">
                                            <GitBranch size={12} /> Branch
                                        </span>
                                        <span className="font-mono text-slate-700 dark:text-slate-300">
                                            {versionInfo.git.branch}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-500 flex items-center gap-1">
                                            <GitCommit size={12} /> Commit
                                        </span>
                                        <span className="font-mono text-slate-700 dark:text-slate-300">
                                            {versionInfo.git.commit.hash}
                                        </span>
                                    </div>
                                </div>

                                {/* Changelog */}
                                {versionInfo.changelog && versionInfo.changelog.length > 0 && (
                                    <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs">
                                        <p className="text-slate-500 font-medium mb-2 flex items-center gap-1">
                                            <GitCommit size={12} /> Changelog
                                        </p>
                                        <div className="space-y-2 max-h-48 overflow-y-auto">
                                            {versionInfo.changelog.map((commit, idx) => (
                                                <div
                                                    key={commit.hash}
                                                    className={cn(
                                                        "py-1.5",
                                                        idx !== versionInfo.changelog.length - 1 && "border-b border-slate-200 dark:border-slate-700"
                                                    )}
                                                >
                                                    <div className="flex items-start gap-2">
                                                        <span className="font-mono text-blue-500 shrink-0">{commit.hash}</span>
                                                        <p className="text-slate-700 dark:text-slate-300 line-clamp-2">
                                                            {commit.message}
                                                        </p>
                                                    </div>
                                                    <p className="text-slate-400 dark:text-slate-500 mt-0.5 text-[10px]">
                                                        {commit.author} · {formatDate(commit.date)}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {showInfo && !versionInfo && (
                            <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs text-slate-500 text-center">
                                {versionLoading ? 'Caricamento...' : versionError ? (
                                    <div className="space-y-2">
                                        <p className="text-red-500">Impossibile caricare le informazioni</p>
                                        <button
                                            onClick={() => setVersionError(false)}
                                            className="text-blue-500 hover:underline"
                                        >
                                            Riprova
                                        </button>
                                    </div>
                                ) : 'Caricamento...'}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
