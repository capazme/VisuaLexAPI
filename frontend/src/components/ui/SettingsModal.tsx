import { X, Monitor, Moon, Sun, Eye } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

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
                    {/* Theme */}
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase mb-3 block">Tema</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button 
                                onClick={() => updateSettings({ theme: 'light' })}
                                className={`flex items-center justify-center gap-2 p-3 rounded-lg border transition-all ${settings.theme === 'light' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                            >
                                <Sun size={18} /> Chiaro
                            </button>
                            <button 
                                onClick={() => updateSettings({ theme: 'dark' })}
                                className={`flex items-center justify-center gap-2 p-3 rounded-lg border transition-all ${settings.theme === 'dark' ? 'border-blue-500 bg-blue-900/20 text-blue-400' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                            >
                                <Moon size={18} /> Scuro
                            </button>
                            <button 
                                onClick={() => updateSettings({ theme: 'sepia' })}
                                className={`flex items-center justify-center gap-2 p-3 rounded-lg border transition-all ${settings.theme === 'sepia' ? 'border-amber-500 bg-amber-50 text-amber-900' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                            >
                                <Eye size={18} /> Seppia
                            </button>
                             <button 
                                onClick={() => updateSettings({ theme: 'high-contrast' })}
                                className={`flex items-center justify-center gap-2 p-3 rounded-lg border transition-all ${settings.theme === 'high-contrast' ? 'border-black bg-white text-black ring-2 ring-black' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                            >
                                <Monitor size={18} /> Contrasto
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

