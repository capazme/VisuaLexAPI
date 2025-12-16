import { X, Monitor, Moon, Sun, Eye, HelpCircle, Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { useAuth } from '../../hooks/useAuth';
import { cn } from '../../lib/utils';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onRestartTour?: () => void;
}

export function SettingsModal({ isOpen, onClose, onRestartTour }: SettingsModalProps) {
    const navigate = useNavigate();
    const { isAdmin } = useAuth();
    const { settings, updateSettings } = useAppStore();

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-md" onClick={onClose} />
            <div className="relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-2xl rounded-2xl shadow-glass-lg w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-white/20 dark:border-white/10">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 dark:border-white/5 bg-white/20 dark:bg-white/5">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        Impostazioni
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Theme - iOS-style Segmented Control */}
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase mb-3 block">Tema</label>
                        <div className="bg-gray-100 dark:bg-gray-800 p-1 rounded-xl grid grid-cols-2 gap-1">
                            <button
                                onClick={() => updateSettings({ theme: 'light' })}
                                className={cn(
                                    "flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all",
                                    settings.theme === 'light'
                                        ? "bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400"
                                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                                )}
                            >
                                <Sun size={16} /> Chiaro
                            </button>
                            <button
                                onClick={() => updateSettings({ theme: 'dark' })}
                                className={cn(
                                    "flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all",
                                    settings.theme === 'dark'
                                        ? "bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400"
                                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                                )}
                            >
                                <Moon size={16} /> Scuro
                            </button>
                            <button
                                onClick={() => updateSettings({ theme: 'sepia' })}
                                className={cn(
                                    "flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all",
                                    settings.theme === 'sepia'
                                        ? "bg-white dark:bg-gray-700 shadow-sm text-amber-600 dark:text-amber-400"
                                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                                )}
                            >
                                <Eye size={16} /> Seppia
                            </button>
                            <button
                                onClick={() => updateSettings({ theme: 'high-contrast' })}
                                className={cn(
                                    "flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all",
                                    settings.theme === 'high-contrast'
                                        ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                                )}
                            >
                                <Monitor size={16} /> Contrasto
                            </button>
                        </div>
                    </div>

                    {/* Typography */}
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase mb-3 block">Tipografia</label>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 p-2 rounded-lg">
                                <span className="text-sm text-gray-600 dark:text-gray-400 px-2">Dimensione</span>
                                <div className="flex gap-1">
                                    {(['small', 'medium', 'large', 'xlarge'] as const).map(size => (
                                        <button
                                            key={size}
                                            onClick={() => updateSettings({ fontSize: size })}
                                            className={`w-8 h-8 flex items-center justify-center rounded text-sm font-bold transition-colors ${settings.fontSize === size ? 'bg-blue-600 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
                                            title={size}
                                        >
                                            {size === 'small' ? 'A' : size === 'medium' ? 'A+' : size === 'large' ? 'A++' : 'A#'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 p-2 rounded-lg">
                                <span className="text-sm text-gray-600 dark:text-gray-400 px-2">Font</span>
                                <div className="flex gap-1">
                                    <button
                                        onClick={() => updateSettings({ fontFamily: 'sans' })}
                                        className={`px-3 py-1.5 rounded text-xs font-sans border ${settings.fontFamily === 'sans' ? 'border-blue-500 bg-white dark:bg-gray-700 text-blue-600' : 'border-transparent hover:bg-gray-200'}`}
                                    >Sans</button>
                                    <button
                                        onClick={() => updateSettings({ fontFamily: 'serif' })}
                                        className={`px-3 py-1.5 rounded text-xs font-serif border ${settings.fontFamily === 'serif' ? 'border-blue-500 bg-white dark:bg-gray-700 text-blue-600' : 'border-transparent hover:bg-gray-200'}`}
                                    >Serif</button>
                                    <button
                                        onClick={() => updateSettings({ fontFamily: 'mono' })}
                                        className={`px-3 py-1.5 rounded text-xs font-mono border ${settings.fontFamily === 'mono' ? 'border-blue-500 bg-white dark:bg-gray-700 text-blue-600' : 'border-transparent hover:bg-gray-200'}`}
                                    >Mono</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Restart Tour */}
                    {onRestartTour && (
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase mb-3 block">Aiuto</label>
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
                            <label className="text-xs font-bold text-gray-500 uppercase mb-3 block">Amministrazione</label>
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
                </div>
            </div>
        </div>
    );
}

