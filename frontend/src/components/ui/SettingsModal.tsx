import { X, Monitor, Moon, Sun, Eye } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { cn } from '../../lib/utils';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const { settings, updateSettings } = useAppStore();

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-200 dark:border-gray-800">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
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
                </div>
            </div>
        </div>
    );
}

