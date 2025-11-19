document.addEventListener('DOMContentLoaded', () => {
    // ============================
    // Configurazione e Costanti
    // ============================
    const DEBUG = true; 
    const logger = {
        log: (...args) => DEBUG && console.log(...args),
        error: (...args) => console.error(...args),
        warn: (...args) => DEBUG && console.warn(...args),
    };

    const ACT_TYPES_REQUIRING_DETAILS = [
        'legge', 'decreto legge', 'decreto legislativo', 
        'Regolamento UE', 'Direttiva UE'
    ];

    // ============================
    // Gestione Stato UI (Theme & Views)
    // ============================
    const UI = {
        themeToggle: document.getElementById('theme-toggle'),
        sidebarToggle: document.getElementById('sidebar-toggle'),
        sidebar: document.getElementById('sidebar'),
        html: document.documentElement,
        
        init() {
            this.initTheme();
            this.initNavigation();
            this.initMobileSidebar();
        },

        initTheme() {
            const savedTheme = localStorage.getItem('theme') || 'light';
            this.setTheme(savedTheme);
            
            if(this.themeToggle) {
                this.themeToggle.addEventListener('click', () => {
                    const currentTheme = this.html.getAttribute('data-theme');
                    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
                    this.setTheme(newTheme);
                });
            }
        },

        setTheme(theme) {
            this.html.setAttribute('data-theme', theme);
            localStorage.setItem('theme', theme);
            const icon = this.themeToggle?.querySelector('i');
            if(icon) {
                icon.className = theme === 'light' ? 'bi bi-moon-stars me-2' : 'bi bi-sun-fill me-2';
                this.themeToggle.innerHTML = theme === 'light' ? 
                    '<i class="bi bi-moon-stars me-2"></i>Tema Scuro' : 
                    '<i class="bi bi-sun-fill me-2"></i>Tema Chiaro';
            }
        },

        initNavigation() {
            const navLinks = document.querySelectorAll('[data-view]');
            const views = document.querySelectorAll('.view-section');
            const title = document.getElementById('current-view-title');

            navLinks.forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    
                    // Update Active Link
                    navLinks.forEach(l => l.classList.remove('active'));
                    link.classList.add('active');

                    // Show View
                    const targetId = link.getAttribute('data-view');
                    views.forEach(view => {
                        if(view.id === targetId) {
                            view.classList.remove('d-none');
                            // Animation
                            view.classList.add('animate-slide-up');
                            setTimeout(() => view.classList.remove('animate-slide-up'), 400);
                        } else {
                            view.classList.add('d-none');
                        }
                    });

                    // Update Title
                    if(title) title.textContent = link.textContent.trim();

                    // Mobile: close sidebar on selection
                    if(window.innerWidth < 768) {
                        this.sidebar.classList.remove('show');
                    }
                });
            });
        },

        initMobileSidebar() {
            if(this.sidebarToggle) {
                this.sidebarToggle.addEventListener('click', () => {
                    this.sidebar.classList.toggle('show');
                });
            }
            // Close when clicking outside
            document.addEventListener('click', (e) => {
                if(window.innerWidth < 768 && 
                   this.sidebar.classList.contains('show') && 
                   !this.sidebar.contains(e.target) && 
                   !this.sidebarToggle.contains(e.target)) {
                    this.sidebar.classList.remove('show');
                }
            });
        }
    };

    // ============================
    // Core Logic Selectors
    // ============================
    const SELECTORS = {
        scrapeForm: '#scrape-form',
        normeContainer: '#norme-container',
        loadingIndicator: '#loading',
        emptyState: '#empty-state',
        errorContainer: '#error-container',
        historyList: '#history-list',
        resetHistoryButton: '#reset-history',
        resetButton: '#reset-button',
        clearSearchFieldsButton: '#clear-search-fields',
        historySearchInput: '#history-search',
        actTypeSelect: '#act_type',
        actNumberInput: '#act_number',
        dateInput: '#date',
        versionRadios: 'input[name="version"]',
        versionDateInput: '#version_date',
        articleInput: '#article',
        incrementButton: '.increment',
        decrementButton: '.decrement',
    };

    const elements = Object.fromEntries(
        Object.entries(SELECTORS).map(([key, selector]) => [
            key,
            key === 'versionRadios' ? document.querySelectorAll(selector) : document.querySelector(selector),
        ])
    );

    // ============================
    // Stato Applicazione
    // ============================
    let pinnedTabs = {};
    let normaContainers = {};

    // ============================
    // Utilities
    // ============================
    const showError = (message) => {
        if (elements.errorContainer) {
            elements.errorContainer.querySelector('.error-text').textContent = message;
            elements.errorContainer.style.display = 'block';
            // Auto-hide after 5 seconds
            setTimeout(hideError, 5000);
        }
    };

    const hideError = () => {
        if (elements.errorContainer) {
            elements.errorContainer.style.display = 'none';
        }
    };

    const sanitize = (str) => str.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase();
    const capitalizeFirstLetter = (string) => string.charAt(0).toUpperCase() + string.slice(1);

    const generateNormaKey = (normaData) => {
        const parts = [normaData.tipo_atto];
        if (normaData.numero_atto?.trim()) parts.push(normaData.numero_atto);
        if (normaData.data?.trim()) parts.push(normaData.data);
        return parts.map(part => sanitize(part)).join('--');
    };

    const generateArticleKey = (normaData) => {
        const parts = [normaData.tipo_atto];
        if (normaData.numero_atto?.trim()) parts.push(normaData.numero_atto);
        if (normaData.data?.trim()) parts.push(normaData.data);
        if (normaData.numero_articolo?.trim()) parts.push(normaData.numero_articolo);
        return parts.map(part => sanitize(part)).join('--');
    };

    // ============================
    // PDF Logic
    // ============================
    const viewPDF = async (urn) => {
        try {
            const modalEl = document.getElementById('pdfModal');
            const progressContainer = document.getElementById('pdfProgressContainer');
            const progressBar = document.getElementById('pdfProgressBar');
            const pdfModal = bootstrap.Modal.getOrCreateInstance(modalEl);
            
            pdfModal.show();
            progressContainer.style.display = 'block';
            progressBar.removeAttribute('value');
            
            const response = await fetch('/export_pdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urn })
            });

            if (!response.ok) throw new Error('Errore durante l\'esportazione del PDF.');

            // Handling stream for progress (simplified for brevity, logic remains same as original)
            const reader = response.body.getReader();
            const chunks = [];
            while(true) {
                const {done, value} = await reader.read();
                if(done) break;
                chunks.push(value);
            }
            
            let totalLength = chunks.reduce((acc, val) => acc + val.length, 0);
            let fullArray = new Uint8Array(totalLength);
            let pos = 0;
            chunks.forEach(chunk => {
                fullArray.set(chunk, pos);
                pos += chunk.length;
            });

            const blob = new Blob([fullArray], { type: 'application/pdf' });
            const url = window.URL.createObjectURL(blob);
            
            document.getElementById('pdfIframe').src = url;
            document.getElementById('downloadPdfBtn').href = url;
            progressContainer.style.display = 'none';

            modalEl.addEventListener('hidden.bs.modal', () => {
                window.URL.revokeObjectURL(url);
                document.getElementById('pdfIframe').src = '';
            }, { once: true });
            
        } catch (error) {
            document.getElementById('pdfProgressContainer').style.display = 'none';
            // Close modal and show error
            const modalEl = document.getElementById('pdfModal');
            const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
            modalInstance.hide();
            showError(error.message);
        }
    };

    // ============================
    // DOM Generation
    // ============================

    const createNormContainer = (normaData) => {
    const template = document.getElementById('norm-collapsible-template');
        if (!template) return null;

        const clone = template.content.cloneNode(true);
        const card = clone.querySelector('.norm-card');
        const header = card.querySelector('.card-header');
        const title = card.querySelector('.norm-title');
        const subtitle = card.querySelector('.norm-subtitle');
        const collapse = card.querySelector('.norm-content');
        
    const normaKey = generateNormaKey(normaData);
    const collapseId = `collapse-${normaKey}`;

        title.textContent = `${capitalizeFirstLetter(normaData.tipo_atto)} ${normaData.numero_atto || ''}`.trim();
        subtitle.textContent = normaData.data ? `Data: ${normaData.data}` : 'Estremi non disponibili';
        
        collapse.id = collapseId;
        header.setAttribute('data-bs-target', `#${collapseId}`);
        card.setAttribute('data-norma-key', normaKey);

        // PDF Button in Header
    if (normaData.urn) {
            const pdfBtn = document.createElement('button');
            pdfBtn.className = 'btn btn-sm btn-outline-danger ms-auto me-2';
            pdfBtn.innerHTML = '<i class="bi bi-file-pdf"></i>';
            pdfBtn.title = "Visualizza PDF";
            pdfBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            viewPDF(normaData.urn);
        });
            // Insert before the chevron
            header.insertBefore(pdfBtn, header.lastElementChild);
    }
    
        elements.normeContainer.prepend(card); // Prepend to show newest first
    
        // Hide empty state
        if(elements.emptyState) elements.emptyState.style.display = 'none';

    return {
            normContainer: card,
            normTabs: card.querySelector('.norm-tabs'),
            normTabContent: card.querySelector('.norm-tab-content'),
            normaKey
    };
};

    const createArticleTab = (articleData, normElements, isPinned = false) => {
        const { normTabs, normTabContent, normaKey } = normElements;
        const normaData = articleData.norma_data;
        const key = generateArticleKey(normaData);
        const articleTabId = `article-${sanitize(key)}`;
    
        if (normTabs.querySelector(`#${articleTabId}-tab`)) return;
    
        // --- Tab Button ---
        const tabTemplate = document.getElementById('article-tab-template');
        const tabClone = tabTemplate.content.cloneNode(true);
        const navItem = tabClone.querySelector('li');
        const navLink = navItem.querySelector('.nav-link');
        
        navLink.id = `${articleTabId}-tab`;
        navLink.href = `#${articleTabId}`;
        navLink.setAttribute('aria-controls', articleTabId);
        navLink.querySelector('.tab-label').textContent = `Art. ${normaData.numero_articolo || '?'}`;
    
        const pinBtn = navItem.querySelector('.pin-button');
        const closeBtn = navItem.querySelector('.close-button');
    
        pinBtn.dataset.key = key;
        closeBtn.dataset.key = key;
    
        normTabs.appendChild(navItem);
    
        // --- Tab Content ---
        const paneTemplate = document.getElementById('article-tab-pane-template');
        const paneClone = paneTemplate.content.cloneNode(true);
        const tabPane = paneClone.querySelector('.tab-pane');
        
        tabPane.id = articleTabId;
        tabPane.setAttribute('aria-labelledby', `${articleTabId}-tab`);
        
        // Metadata Injection
        const detailsContainer = tabPane.querySelector('.norma-details');
        detailsContainer.innerHTML = `
            <span class="badge bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle">
                ${articleData.versione || 'Vigente'}
            </span>
            <span><i class="bi bi-calendar3 me-1"></i>${articleData.data_versione || 'N/A'}</span>
            ${articleData.allegato ? `<span><i class="bi bi-paperclip me-1"></i>${articleData.allegato}</span>` : ''}
        `;

        // CKEditor
        const textArea = tabPane.querySelector('.article-text');
        let formattedText = articleData.article_text || '';
        if (!formattedText.includes('<br>') && !formattedText.includes('<p>')) {
            formattedText = formattedText.replace(/\n/g, '<br>');
        }
        textArea.value = formattedText;
    
        // Init Editor
        initCKEditor(textArea).then(editor => {
            articleData.editor = editor;
        });

        // Brocardi
        const brocardiContainer = tabPane.querySelector('.brocardi-info');
        const brocardiContent = tabPane.querySelector('.brocardi-content');
        
        if (articleData.brocardi_info && Object.keys(articleData.brocardi_info).length > 0) {
            brocardiContainer.style.display = 'block';
            populateBrocardiInfo(articleData.brocardi_info, brocardiContent);
        }

        // Normattiva Link
        if(normaData.urn) {
            const linkDiv = document.createElement('div');
            linkDiv.className = 'mt-3 pt-2 border-top';
            linkDiv.innerHTML = `<a href="${normaData.urn}" target="_blank" class="small text-primary text-decoration-none"><i class="bi bi-box-arrow-up-right me-1"></i>Visualizza su Normattiva</a>`;
            tabPane.querySelector('.article-content-wrapper').after(linkDiv);
        }

        normTabContent.appendChild(tabPane);

        // Event Handlers
        navLink.addEventListener('click', (e) => {
            e.preventDefault();
            activateTab(navLink, tabPane, normTabs, normTabContent);
        });

        pinBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePin(key, articleData, pinBtn, navLink);
        });

        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeTab(navItem, tabPane, articleData, key, normElements);
        });

        // Activate newly created tab
        activateTab(navLink, tabPane, normTabs, normTabContent);
        
        // Update Pin State
        if(isPinned || pinnedTabs[key]) {
            navLink.classList.add('pinned');
            pinBtn.classList.replace('bi-pin-angle', 'bi-pin-fill');
        }
    };

    // Helper to activate bootstrap tab manually (since we are dynamic)
    const activateTab = (link, pane, tabsContainer, contentContainer) => {
        tabsContainer.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        contentContainer.querySelectorAll('.tab-pane').forEach(p => {
            p.classList.remove('show', 'active');
        });
        link.classList.add('active');
        pane.classList.add('show', 'active');
    };

    const initCKEditor = (element) => {
        const { ClassicEditor, Essentials, Bold, Italic, Underline, Highlight, Paragraph } = CKEDITOR;
        return ClassicEditor.create(element, {
            plugins: [Essentials, Bold, Italic, Underline, Highlight, Paragraph],
            toolbar: ['bold', 'italic', 'underline', '|', 'highlight', '|', 'undo', 'redo'],
        }).catch(err => logger.error("CKEditor Error", err));
    };

    const populateBrocardiInfo = (info, container) => {
        container.innerHTML = ''; // Clear previous content

        const addSection = (title, content) => {
            if(!content || (Array.isArray(content) && content.length === 0)) return;
            
            // Unique ID for collapse
            const sectionId = `brocardi-${title}-${Math.random().toString(36).substr(2, 9)}`;
            
            // Wrapper Card
            const card = document.createElement('div');
            card.className = 'card mb-3 border brocardi-section shadow-sm';
            
            // Header
            const header = document.createElement('div');
            header.className = 'card-header bg-body-secondary d-flex justify-content-between align-items-center py-2 cursor-pointer';
            header.setAttribute('data-bs-toggle', 'collapse');
            header.setAttribute('data-bs-target', `#${sectionId}`);
            header.setAttribute('aria-expanded', 'true');
            header.setAttribute('aria-controls', sectionId);
            header.innerHTML = `
                <strong class="text-secondary small text-uppercase mb-0">
                    <i class="bi bi-info-circle me-2 text-primary"></i>${title}
                </strong>
                <i class="bi bi-chevron-down transition-transform text-muted small"></i>
            `;

            // Collapse Content
            const collapseDiv = document.createElement('div');
            collapseDiv.className = 'collapse show';
            collapseDiv.id = sectionId;
            
            const body = document.createElement('div');
            // Use standard padding for body, unless it's the Massime accordion container
            body.className = (title === 'Massime' && Array.isArray(content)) ? 'card-body p-0' : 'card-body p-0';
            
            let contentHTML = '';
            
            // Special handling for Massime: Accordion/Collapsible items
            if (title === 'Massime' && Array.isArray(content)) {
                 const accordionId = `accordion-${sectionId}`;
                 contentHTML = `<div class="accordion accordion-flush" id="${accordionId}">`;
                 
                 let visibleIndex = 0;
                 content.forEach((item, index) => {
                     if (!item || !item.toString().trim()) return;
                     visibleIndex++;
                     const itemId = `${sectionId}-item-${index}`;
                     const itemStr = item.toString();
                     // Preview text logic: first ~10 words or first 60 chars
                     const cleanItem = itemStr.replace(/<[^>]*>/g, ''); // simple strip tags if any
                     const preview = cleanItem.length > 60 ? cleanItem.substring(0, 60) + '...' : cleanItem;
                     
                     contentHTML += `
                        <div class="accordion-item">
                            <h2 class="accordion-header">
                                <button class="accordion-button collapsed py-2 shadow-none" type="button" data-bs-toggle="collapse" data-bs-target="#${itemId}">
                                    <div class="d-flex align-items-center overflow-hidden w-100">
                                        <span class="badge bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle rounded-pill me-2" style="min-width: 24px;">${visibleIndex}</span>
                                        <small class="text-muted text-truncate fst-italic">${preview}</small>
                                    </div>
                                </button>
                            </h2>
                            <div id="${itemId}" class="accordion-collapse collapse" data-bs-parent="#${accordionId}">
                                <div class="accordion-body text-secondary small massima-scrollable">
                                    ${itemStr}
                                </div>
                            </div>
                        </div>
                     `;
                 });
                 contentHTML += '</div>';
            } 
            // Standard List (e.g. Brocardi)
            else if(Array.isArray(content)) {
                contentHTML = '<ul class="list-group list-group-flush">';
                content.forEach(item => {
                    if(item && item.toString().trim()) contentHTML += `<li class="list-group-item bg-transparent brocardi-item">${item.toString()}</li>`;
                });
                contentHTML += '</ul>';
            } 
            // Single Text (Ratio, Spiegazione)
            else {
                contentHTML = `<div class="p-3">${content}</div>`;
            }
            
            body.innerHTML = contentHTML;
            collapseDiv.appendChild(body);
            
            card.appendChild(header);
            card.appendChild(collapseDiv);
            
            container.appendChild(card);
        };

        addSection('Brocardi', info.Brocardi);
        addSection('Ratio', info.Ratio);
        addSection('Spiegazione', info.Spiegazione);
        addSection('Massime', info.Massime);
    };

    // ============================
    // Tab Management (Pin/Close)
    // ============================
    const togglePin = (key, data, btn, link) => {
        if(pinnedTabs[key]) {
            delete pinnedTabs[key];
            link.classList.remove('pinned');
            btn.classList.replace('bi-pin-fill', 'bi-pin-angle');
        } else {
            pinnedTabs[key] = data;
            link.classList.add('pinned');
            btn.classList.replace('bi-pin-angle', 'bi-pin-fill');
        }
        localStorage.setItem('pinnedTabs', JSON.stringify(pinnedTabs));
    };

    const closeTab = (navItem, tabPane, data, key, normElements) => {
        if(data.editor) data.editor.destroy();
        
        navItem.remove();
        tabPane.remove();
        
        if(pinnedTabs[key]) {
            delete pinnedTabs[key];
            localStorage.setItem('pinnedTabs', JSON.stringify(pinnedTabs));
        }

        // Remove container if empty
        if(normElements.normTabs.children.length === 0) {
            normElements.normContainer.remove();
            delete normaContainers[normElements.normaKey];
            
            // Show empty state if no norms left
            if(Object.keys(normaContainers).length === 0 && elements.emptyState) {
                elements.emptyState.style.display = 'block';
            }
        }
    };

    // ============================
    // Form Logic
    // ============================
    const handleFormSubmit = async (e) => {
        e.preventDefault();
        hideError();
        
    if (!elements.scrapeForm.checkValidity()) {
            e.stopPropagation();
            elements.scrapeForm.classList.add('was-validated');
        return;
    }

        elements.loadingIndicator.style.display = 'block';
        elements.emptyState.style.display = 'none';

    const formData = new FormData(elements.scrapeForm);
    const data = Object.fromEntries(formData.entries());
        data.article = elements.articleInput.value;

        const wantsBrocardi = document.getElementById('show_brocardi_info')?.checked;
    const endpoint = wantsBrocardi ? '/fetch_all_data' : '/stream_article_text';

    try {
        if (wantsBrocardi) {
                const res = await fetch(endpoint, {
                method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(data)
            });
                if(!res.ok) throw new Error('Errore richiesta');
                const results = await res.json();
                results.forEach(r => processResult(r));
            } else {
                // Streaming Logic
                const res = await fetch(endpoint, {
            method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(data)
        });
                if(!res.ok) throw new Error('Errore richiesta');

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    buffer += decoder.decode(value, {stream: true});
                    const lines = buffer.split('\n');
            buffer = lines.pop();
                    for(let line of lines) {
                        if(line.trim()) processResult(JSON.parse(line));
            }
        }
                if(buffer.trim()) processResult(JSON.parse(buffer));
            }
            
            saveToHistory(data);

        } catch (err) {
            showError(err.message);
    } finally {
            elements.loadingIndicator.style.display = 'none';
    }
};

    const processResult = (result) => {
        const normaData = result.norma_data;
        if(!normaData) return;

        const normaKey = generateNormaKey(normaData);
        let normElements = normaContainers[normaKey];
        if(!normElements) {
            normElements = createNormContainer(normaData);
            normaContainers[normaKey] = normElements;
        }
        createArticleTab(result, normElements);
    };

    const saveToHistory = (data) => {
        if(!elements.historyList) return;
        const li = document.createElement('li');
        li.className = 'list-group-item bg-transparent border-bottom';
        li.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <strong class="text-primary">${capitalizeFirstLetter(data.act_type)} ${data.act_number || ''}</strong>
                    <span class="text-muted small ms-2">Art. ${data.article}</span>
                </div>
                <small class="text-muted">${new Date().toLocaleTimeString()}</small>
            </div>
        `;
        elements.historyList.prepend(li);
    };

    // ============================
    // Initialization
    // ============================
    const init = () => {
        UI.init();

        // Form Interactions
        elements.actTypeSelect.addEventListener('change', () => {
            const val = elements.actTypeSelect.value;
            const required = ACT_TYPES_REQUIRING_DETAILS.includes(val);
            elements.actNumberInput.disabled = !required;
            elements.dateInput.disabled = !required;
            if(!required) {
                elements.actNumberInput.value = '';
                elements.dateInput.value = '';
                    }
                });

        elements.incrementButton?.addEventListener('click', () => elements.articleInput.value++);
        elements.decrementButton?.addEventListener('click', () => {
            if(elements.articleInput.value > 1) elements.articleInput.value--;
        });

        elements.scrapeForm?.addEventListener('submit', handleFormSubmit);
        
        elements.resetButton?.addEventListener('click', () => {
        elements.scrapeForm.reset();
        elements.scrapeForm.classList.remove('was-validated');
        });

        elements.clearSearchFieldsButton?.addEventListener('click', () => {
            elements.scrapeForm.reset();
        });

        // Load Pinned Tabs
        try {
            const saved = localStorage.getItem('pinnedTabs');
            if(saved) {
                pinnedTabs = JSON.parse(saved);
                Object.values(pinnedTabs).forEach(processResult);
        }
        } catch(e) { console.error(e); }
    };

    init();
});
