(function(exports) {
    "use strict";

    // reference the parent ReaderControl
    exports.DesktopReaderControl = exports.ReaderControl;

    exports.ReaderControl = function(options) {
        var me = this;
        this.showFilePicker = options.showFilePicker;
        this.useDownloader = _.isUndefined(options.useDownloader) ? true : !!options.useDownloader;

        exports.DesktopReaderControl.call(this, options);
        me.fireError = function (msg, genericMsg) {
            console.warn('Error: ' + msg);
            me.fireEvent('error', [msg, genericMsg]);
        };

        this.pdfType = options.pdfType;
        this.officeType = options.officeType;
        this.initProgress();

        this.workerHandlers = {
            workerLoadingProgress: function(percentComplete) {
                me.fireEvent('workerLoadingProgress', percentComplete);
            }
        };



        var autoLoadPdf = this.pdfType === 'auto' || this.pdfType === 'wait';
        var autoLoadOffice = this.officeType === 'auto' || this.officeType === 'wait';
        var defaultBackendTypePromise;
        if(autoLoadPdf || autoLoadOffice) {
            defaultBackendTypePromise = exports.CoreControls.getDefaultBackendType();
        }

        this.pdfTypePromise = autoLoadPdf ? defaultBackendTypePromise : Promise.resolve(this.pdfType);
        this.officeTypePromise = autoLoadOffice ? defaultBackendTypePromise : Promise.resolve(this.officeType);

        if (options.preloadWorker) {
            if(this.pdfType !== 'wait') {
                this.pdfTypePromise.then(function(pdfType) {
                    var useEmscriptenWhileLoading = me.pdfType !== 'pnacl' && !exports.CoreControls.isSubzeroEnabled();
                    exports.CoreControls.preloadPDFWorker(pdfType, me.workerHandlers, {
                        useEmscriptenWhileLoading: useEmscriptenWhileLoading,
                        autoSwap: false
                    });
                });
            }

            if(this.officeType !== 'wait') {
                this.officeTypePromise.then(function(officeType) {
                    var useEmscriptenWhileLoading = me.officeType !== 'pnacl' && !exports.CoreControls.isSubzeroEnabled();
                    exports.CoreControls.preloadOfficeWorker(officeType, me.workerHandlers, {
                        useEmscriptenWhileLoading: useEmscriptenWhileLoading,
                        autoSwap: false
                    });
                });
            }
        }

        this.filename = 'downloaded.pdf';

        // code to handle password requests from DocumentViewer
        var passwordDialog;
        var passwordInput;
        var passwordMessage;
        var showTextMessage;
        var finishedPassword;
        var tryingPassword;
        me.getPassword = function(passwordCallback) {
            // only allow a few attempts
            finishedPassword = me.passwordTries >= 3;
            tryingPassword = false;
            if (me.passwordTries === 0) {
                // first try so we create the dialog
                passwordDialog = $('<div>').attr({
                    'id': 'passwordDialog'
                });

                showTextMessage = $('<div style="color:red"></div>').appendTo(passwordDialog);

                passwordMessage = $('<label>').attr({
                    'for': 'passwordInput'
                })
                    .text('Enter the document password:')
                    .appendTo(passwordDialog);

                passwordInput = $('<input>').attr({
                    'type': 'password',
                    'id': 'passwordInput'
                }).keypress(function(e) {
                    if (e.which === 13) {
                        $(this).parent().next().find('#pass_ok_button').click();
                    }
                }).appendTo(passwordDialog);

                passwordDialog.dialog({
                    modal: true,
                    resizable: false,
                    closeOnEscape: false,
                    position: {
                        within: document.body
                    },
                    close: function () {
                        if (!tryingPassword) {
                            me.fireError("The document requires a valid password.", i18n.t('error.EncryptedUserCancelled'));
                        }
                    },
                    buttons: {
                        'OK': {click: function() {
                                if (!finishedPassword) {
                                    tryingPassword = true;
                                    passwordCallback(passwordInput.val());
                                }
                                $(this).dialog('close');
                            },
                            id: 'pass_ok_button',
                            text: 'OK'
                        },
                        'Cancel': function() {
                            $(this).dialog('close');
                        }
                    }
                });

            } else if (finishedPassword) {
                // attempts have been used
                me.fireError("The document requires a valid password.", i18n.t('error.EncryptedAttemptsExceeded'));
            } else {
                // allow another request for the password
                passwordInput.val('');
                showTextMessage.text('The Password is incorrect. Please make sure that Caps lock is not on by mistake, and try again.');
                passwordDialog.dialog('open');
            }

            ++(me.passwordTries);
        };

        me.onDocError = function (err) {
            if (err.stack) {
                console.log(err.stack);
            }
            me.fireError(err.message, i18n.t(me.usingOfficeWorker?'error.OfficeLoadError':'error.PDFLoadError'));
        };
    };

    exports.ReaderControl.prototype = {
        // we are fine with using a larger max zoom (like 1000%) unlike XOD webviewer
        MAX_ZOOM: 10,
        MIN_ZOOM: 0.05,
        // PDF units are 72 points per inch so we need to adjust it to 96 dpi for window.print()
        printFactor: 96/72,

        supportedPDFExtensions: ['pdf', 'jpg', 'jpeg', 'png'],
        supportedOfficeExtensions: ['docx', 'xlsx', 'pptx', 'md'], 

        /**
         * Initialize UI controls.
         * @ignore
         */
        initUI: function() {
            var me = this;

            exports.DesktopReaderControl.prototype.initUI.call(this);

            var $printParent = me.createPDFDownloadButton();

            if (this.showFilePicker) {
                var hasPDFExtensions = this.supportedPDFExtensions.length>0;
                var hasOfficeExtensions = this.supportedOfficeExtensions.length>0;
                var filterString = "." + this.supportedPDFExtensions.join(',.') + (hasPDFExtensions&&hasOfficeExtensions?",.":"") + this.supportedOfficeExtensions.join(',.');
                var $filePicker = $('<label for="input-pdf" class="file-upload glyphicons folder_open"></label>' +
                    '<input id="input-pdf"  accept="' + filterString + '" type="file" class="input-pdf">')
                    .attr('data-i18n', '[title]controlbar.open')
                    .i18n();
                $printParent.append($filePicker);

                $filePicker.on('change', me.listener.bind(me));

                // if filepicker is supported we also want to support drag and drop
                var uiDisplayElement = document.getElementById("ui-display");

                uiDisplayElement.addEventListener('dragover', function(e) {
                    e.stopPropagation();
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                });

                // Get file data on drop
                uiDisplayElement.addEventListener('drop', function(e) {
                    e.stopPropagation();
                    e.preventDefault();
                    var files = e.dataTransfer.files; // Array of all files
                    var firstFile = files[0];
                    if(firstFile && (firstFile.type ==='application/pdf' || firstFile.type === 'image/jpeg'   || firstFile.type === 'image/png' ||
                        firstFile.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
                            || firstFile.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
                            || firstFile.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation')) {
                        // load the first file in this case
                        me.loadLocalFile(firstFile, {
                        filename: me.parseFileName(firstFile.name)
                        });
                    }
                });

            }
            me.saveInProgress = false;

        },

        createPDFDownloadButton: function ()
        {
            var me = this;
            var existing = $('#PDFDownloadButtonContainer');
            if(existing.length > 0)
            {
                return;
            }

            var downloadButton =  $('<div></div>').attr({id: 'PDFDownloadButtonContainer'})
                .append( $('<span></span>')
                .addClass('glyphicons disk_save ')
                .attr({
                    id: 'downloadButton',
                    'data-i18n': '[title]controlbar.download'
                }).i18n());

            existing = $('#OfficeDownloadButtonContainer');
            if(existing.length > 0)
            {
                existing.replaceWith(downloadButton);
            }
            else
            {
                var $printParent = $('#printButton').parent();
                $printParent.append(downloadButton);
                existing = $printParent;
            }

            downloadButton.on('click', function () {
                me.activeButtonID = '#downloadButton';
                me.activeButtonClass = 'disk_save';
                me.downloadFile({downloadType:'pdf'});
            });
            return existing;
        },

        createOfficeDownloadButton: function ()
        {
            var existing = $('#OfficeDownloadButtonContainer');
            if(existing.length > 0)
            {
                return;
            }
            var me = this;
            var downloadButtonPDF =  $('<div></div>').addClass("labelled-button-row")
                .append( $('<span></span>')
                    .addClass('glyphicons file_export labelled-button')
                    .attr({
                        id: 'exportPDFButton',
                        'data-i18n': '[title]controlbar.convertToPDF'
                    }).i18n())
                .append($('<span></span>').addClass('heading labelled-button-text')
                .attr({'data-i18n': '[title]controlbar.convertToPDF;controlbar.convertToPDF'})
                .i18n());
            var downloadOfficeButton =  $('<div></div>').addClass("labelled-button-row")
                .append( $('<span></span>')
                    .addClass('glyphicons floppy_save labelled-button')
                    .attr({
                        id: 'downloadOfficeButton',
                        'data-i18n': '[title]controlbar.download'
                    }).i18n())
                .append($('<span></span>').addClass('heading labelled-button-text')
                .attr({'data-i18n': '[title]controlbar.download;controlbar.download'})
                .i18n());

            var outer = $('<div></div>').attr({id: 'OfficeDownloadButtonContainer'});

            $('<span></span>').addClass('current-layout drop-target glyphicons disk_save')
                .appendTo(outer);
            var current = $('<div></div>').addClass('hidden')
                .appendTo(outer);
            current = $('<div></div>').addClass('content  download-drop')
                .appendTo(current);
            current.append(downloadButtonPDF);
            current.append(downloadOfficeButton);

            downloadButtonPDF.on('click', function () {
                me.activeButtonID = '#exportPDFButton';
                me.activeButtonClass = 'file_export';
                me.downloadFile({downloadType:'pdf'});
            });
            downloadOfficeButton.on('click', function () {
                me.activeButtonID = '#downloadOfficeButton';
                me.activeButtonClass = 'floppy_save';
                me.downloadFile({downloadType:'office'});
            });

            existing = $('#PDFDownloadButtonContainer');
            if(existing.length > 0)
            {
                existing.replaceWith(outer);
            }
            else
            {
                var $printParent = $('#printButton').parent();
                $printParent .append(outer);
                existing = $printParent;
            }
            
            // drop code lifted from 
            var drop = new Drop({
                target: document.querySelector('#OfficeDownloadButtonContainer .drop-target'),
                content: document.querySelector('#OfficeDownloadButtonContainer .content'),
                position: 'bottom center',
                openOn: 'hover',
                classes: 'drop-theme-arrows-bounce layout-mode-dropdown-content',
                tetherOptions: {
                    targetOffset: '8px 0'
                }
            });

            drop.once('open', function() {
                me.docViewer.trigger('displayModeUpdated');
                var content = $(this.drop);
                content.i18n();
                content.css('z-index', 50);
            });

            drop.on('close', function() {
                // workaround so that IE9 doesn't show the menu when hovering over the area where it should be hidden
                $(this.drop).css({
                    'left': -1000,
                    'top': -1000,
                    'transform': ''
                });
            });

            return existing;
        },


        downloadFile: function(options) {
            var me = this;
            var current_document = me.docViewer.getDocument();
            if (me.saveInProgress || !current_document) {
                return;
            }
            // If there are any free hand annotations that haven't been completely created yet
            // this will make sure that they exist in the downloaded pdf
            this.toolModeMap[exports.PDFTron.WebViewer.ToolMode.AnnotationCreateFreeHand].complete();

            me.saveInProgress = true;
            me.saveCancelled = false;

            var button_id = me.activeButtonID || '#downloadButton';
            var button_class = me.activeButtonClass || 'file_save';
            var downloadButton = $(button_id);
            downloadButton.removeClass(button_class);
            downloadButton.addClass('refresh');
            downloadButton.addClass('rotate-icon');
            var endLoading = function() {
                me.saveInProgress = false;
                downloadButton.removeClass('refresh');
                downloadButton.removeClass('rotate-icon');
                downloadButton.addClass(button_class);
            };

            var annotManager = me.docViewer.getAnnotationManager();
            options["xfdfString"] = options["xfdfString"]  || annotManager.exportAnnotations();
            if(!me.saveCancelled) {
                // For non-web browser based WebViewer (e.g. Cordova, Qt, WkWebView, Node.js, etc.)
                // We pass the xfdf string directly to the worker...
                me.getFileData(options).then(function (data) {
                    endLoading();
                    // if the save was cancelled we don't want to go ahead with it
                    if(!me.saveCancelled) {
                        var arr = new Uint8Array(data); // should be removed soon
                        var blob = new Blob([arr], {
                            type: me.downloadMimeType
                        });
                        var extension = options["downloadType"] === "pdf" ? ".pdf" : me.downloadExtension;
                        saveAs(blob, me.getDownloadFilename(me.filename, extension));
                        me.fireEvent('finishedSavingPDF');
                    }

                },
                function onDownloadFailed(error) {
                    endLoading();
                    if(error && error.type && error.type === "Cancelled" ) {
                        console.log("Save operation was cancelled");
                    }
                    else {
                        throw new Error(error.message);
                    }

                });
            }
        },

        getFileData: function(options) {
            var current_document = this.docViewer.getDocument();
            return current_document.getFileData(options);
        },

        getFilename: function(){
            return this.filename;
        },

        getDownloadFilename: function(filename, extension) {
            if (filename && filename.slice(-extension.length).toLowerCase() !== extension) {
                filename += extension;
            }
            return filename;
        },

        loadDocumentConfirm: function() {
            var me = this;
            return new Promise(function(resolve,reject) {
                if(!me.saveInProgress) {
                    resolve();
                    return;
                }

                // first try so we create the dialog
                var loadConfirmDialog = $('<div>').attr({
                    'id': 'loadConfirmDialog'
                });

                var loadMessage = $('<label>')
                    .text('Are you sure you want to cancel the current document download and load the new document?')
                    .appendTo(loadConfirmDialog);

                var onLoadFunction = function() {
                    loaded = true;
                    loadMessage.text("Download Complete. Continuing to new document.");
                    loadConfirmDialog.dialog("option", "buttons", {'OK': okButton});
                };
                var onFinished = function() {
                    $(document).off('finishedSavingPDF', onLoadFunction);
                };

                $(document).on('finishedSavingPDF', onLoadFunction);

                var okButton = {click: function() {
                                resolve();
                                $(this).dialog('close');
                            },
                            id: 'load_ok_button',
                            text: 'OK'
                        };

                var loaded = false;

                loadConfirmDialog.dialog({
                    modal: true,
                    resizable: false,
                    closeOnEscape: false,
                    position: {
                        within: document.body
                    },
                    close: function () {
                        onFinished();
                        reject("The load operation was cancelled");
                        $(this).dialog('close');
                    },
                    buttons: {
                        'OK': okButton,
                        'Cancel': function() {
                            onFinished();
                            reject("The load operation was cancelled");
                            $(this).dialog('close');
                        }
                    }
                });
            });
        },


        /**
         * Loads a PDF document into the ReaderControl
         * @param {string} doc a resource URI to the document. The URI may be an http or blob URL.
         * @param loadOptions options to load the document
         * @param loadOptions.filename the filename of the document to load. Used in the export/save PDF feature.
         * @param loadOptions.customHeaders specifies custom HTTP headers in retrieving the resource URI.
         * @param loadOptions.withCredentials The withCredentials property is a boolean that indicates whether or not cross-site Access-Control requests
            should be made using credentials sucess as cookies, authorization headers or TLS client certificates. Setting withCredentials has no effect on
            same-site requests.
         * @param loadOptions.workerTransportPromise optionally specifies a worker transport promise to be used
         * @param loadOptions.useDownloader When downloading a PDF, whether it should be downloaded using Downloader (defaults to true)
         */
        loadDocument: function (doc, options) {

            var me = this;
            this.loadDocumentConfirm().then(function() {
                me.showProgress();
                me.closeDocument();

                // in case a save or print is still going we want to cancel it
                me.saveCancelled = true;
                me.printCancelled = true;

                var pdfPartRetriever = new CoreControls.PartRetrievers.ExternalPdfPartRetriever(doc, {
                    useDownloader: me.useDownloader,
                    withCredentials: options && options.withCredentials,
                    filename: options && options.filename
                });
                if (options && options.customHeaders) {
                    pdfPartRetriever.setCustomHeaders(options.customHeaders);
                }
                if (options && options.filename) {
                    me.filename = options.filename;
                } else {
                    me.filename = me.parseFileName(doc);
                }

                pdfPartRetriever.on('documentLoadingProgress', function(e, loaded, total) {
                    me.fireEvent('documentLoadingProgress', [loaded, total]);
                });
                pdfPartRetriever.on('error', function(e, type, message) {
                    me.fireEvent('error', [message, i18n.t('error.load') + ': ' + message]);
                });

                me.loadAsync(me.docId, pdfPartRetriever, options);
            },
            function() {
                // cancelled so do nothing
            });
        },

        loadLocalFile: function(file, options) {
            var me = this;
            this.loadDocumentConfirm().then(function() {
                me.showProgress();
                me.closeDocument();

                // in case a save or print is still going we want to cancel it
                me.saveCancelled = true;
                me.printCancelled = true;

                var partRetriever = new CoreControls.PartRetrievers.LocalPdfPartRetriever(file);
                partRetriever.on('documentLoadingProgress', function(e, loaded, total) {
                    me.fireEvent('documentLoadingProgress', [loaded, total]);
                });

                // get the filename so we can use it when downloading the file
                if (options.filename) {
                    me.filename = options.filename;
                }

                // load the document into the viewer
                me.loadAsync(window.readerControl.docId, partRetriever, options);

            }, function() {
                // cancelled so do nothing
            });
        },

        loadAsync: function (id, partRetriever, options) {
            var me = this;

            var getExtension = function(filename, supportedExtensions) {
                var extension;
                if (filename) {
                    var extensionStartIndex = filename.lastIndexOf('.');
                    if (extensionStartIndex !== -1) {
                        var foundExtension = filename.slice(extensionStartIndex + 1).toLowerCase() || 'pdf';
                        for(var i=0; i<supportedExtensions.length; ++i) {
                            if(foundExtension.indexOf(supportedExtensions[i])===0) {
                                extension = supportedExtensions[i];
                                break;
                            }
                        }
                    }
                }
                return extension;
            };

            // we determine at this point

            var useOfficeWorker = false;
            var extension = 'pdf';
            this.downloadMimeType = "application/pdf";
            this.downloadExtension = ".pdf";
            extension = getExtension(me.filename, this.supportedPDFExtensions) || extension;
            var officeExtension = getExtension(me.filename, this.supportedOfficeExtensions);
            if(officeExtension) {
                useOfficeWorker = true;
                extension = officeExtension;
                switch(extension) {
                    case "docx":
                        this.downloadMimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
                    break;
                    case "pptx":
                        this.downloadMimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
                    break;
                    case "xlsx":
                        this.downloadMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
                    break;
                    case "doc":
                    case "xls":
                    case "ppt":
                        this.downloadMimeType = "application/msword";
                        break;
                    case "md":
                        this.downloadMimeType = "text/markdown";
                    break;
                }
                this.downloadExtension = "." + officeExtension;
                me.createOfficeDownloadButton();
            }
            else{
                me.createPDFDownloadButton();
            }
            this.usingOfficeWorker = useOfficeWorker;

            (useOfficeWorker?this.officeTypePromise:this.pdfTypePromise).then(function(backendType) {
                var defaultOptions = {
                    type: (useOfficeWorker?'office':'pdf'),
                    docId: id,
                    extension: extension,
                    getPassword: me.getPassword,
                    onError: me.onDocError,
                    backendType: backendType,
                    workerHandlers: me.workerHandlers,
                    defaultPageSize: me.defaultPageSize,
                    pageSizes: me.pageSizes
                };

                options = $.extend({}, defaultOptions, options);

                if (useOfficeWorker && !options.officeWorkerTransportPromise) {
                    options.workerTransportPromise =  CoreControls.initOfficeWorkerTransports(backendType, me.workerHandlers);
                } else if (!useOfficeWorker && !options.workerTransportPromise) {
                    options.workerTransportPromise = CoreControls.initPDFWorkerTransports(backendType, me.workerHandlers);
                } else if (useOfficeWorker) {
                    options.workerTransportPromise = options.officeWorkerTransportPromise;
                }

                // add error handling for worker startup
                options.workerTransportPromise.catch(function(workerError) {
                    if(typeof workerError === "string") {
                        me.fireError(workerError, workerError);
                    }
                    else {
                        me.fireError(workerError.message, i18n.t(workerError.userMessage));
                    }

                });

                me.docViewer.setRenderBatchSize(2);
                me.docViewer.setViewportRenderMode(true);
                me.passwordTries = 0;
                me.hasBeenClosed = false;
                me.docViewer.loadAsync(partRetriever, options);
            });
        },

        initProgress: function () {
            var me = this;
            this.$progressBar = $('<div id="pdf-progress-bar"><div class="progress-text"></div><div class="progress-bar"><div style="width:0%">&nbsp;</div><span>&nbsp;</span></div></div>');
            $('body').append(this.$progressBar);

            var viewerLoadedDeferred = new $.Deferred();
            var documentLoadedDeferred = new $.Deferred();
            this.$progressBar.find('.progress-text').text(i18n.t('Initializing'));
            this.$progressBar.find('.progress-bar div').css({ width: 100 + '%' });

            $(document).on('workerLoadingProgress', function (e, progress) {
                var failed = me.$progressBar.hasClass('document-failed');
                var pro_per = Math.round(progress * 100);
                var finished = progress >= 1 && !failed;

                if (pro_per > 0 && !failed && !finished) {
                    me.$progressBar.find('.progress-text').text(i18n.t('initialize.pnacl') + pro_per + '%');
                }
                me.$progressBar.find('.progress-bar div').css({ width: pro_per + '%' });
                if (progress >= 1 && !failed) {
                    viewerLoadedDeferred.resolve();
                    me.$progressBar.find('.progress-text').text(i18n.t('Initializing') + ' ' + pro_per + '%');
                }
            }).on('documentLoadingProgress', function (e, bytesLoaded, bytesTotal) {
                var loadedPercent = -1;
                if (bytesTotal > 0) {
                    loadedPercent = Math.round(bytesLoaded / bytesTotal * 100);
                }

                if (viewerLoadedDeferred.state() !== 'pending' || !me.$progressBar.hasClass('document-failed')) {
                    //viewer is already, so show document progress

                    if (loadedPercent >= 0) {
                        if (!me.$progressBar.hasClass('document-failed')) {
                            me.$progressBar.find('.progress-text').text(i18n.t('initialize.loadDocument') + loadedPercent + '%');
                        }
                        me.$progressBar.find('.progress-bar div').css({ width: loadedPercent + '%' });
                    } else {
                        var kbLoaded = Math.round(bytesLoaded / 1024);
                        if (!me.$progressBar.hasClass('document-failed')) {
                            me.$progressBar.find('.progress-text').text(i18n.t('initialize.loadDocument') + kbLoaded + 'KB');
                            me.$progressBar.find('.progress-bar div').css({ width: '100%' });
                        }
                    }
                }

                if (bytesLoaded === bytesTotal) {
                    documentLoadedDeferred.resolve();
                }
            });

            $(document).on('documentLoaded', function () {
                //viewer ready
                if (!me.$progressBar.hasClass('document-failed')) {
                    me.$progressBar.fadeOut();
                    clearTimeout(me.initialProgressTimeout);
                }
            });

            this.onError = function (e, msg, userMsg) {
                me.$progressBar.find('.progress-text').text(userMsg);
                me.$progressBar.addClass('document-failed');
                me.$progressBar.show();
                clearTimeout(me.initialProgressTimeout);
            };

            me.$progressBar.hide();

        },

        showProgress: function () {
            var me = this;
            this.$progressBar.hide();
            this.$progressBar.find('.progress-text').text(i18n.t('Initializing'));
            this.initialProgressTimeout = setTimeout(function() {
                me.$progressBar.fadeIn('slow');
                // need to make sure that the document failed class has been removed
                // since we are now loading a new document
                me.$progressBar.removeClass('document-failed');
            }, 2000);
        },

        parseFileName: function(fullPath) {
            var startIndex = (fullPath.indexOf('\\') >= 0 ? fullPath.lastIndexOf('\\') : fullPath.lastIndexOf('/'));
            var filename = fullPath.substring(startIndex);
            if (filename.indexOf('\\') === 0 || filename.indexOf('/') === 0) {
                return filename.substring(1);
            }
            else {
                return filename;
            }
        },

        printHandler: function() {
            var me = this;
            // currently disable printing password protected files with PDFium since it doesn't appear to work
            if(!me.passwordTries) {
                (this.usingOfficeWorker?Promise.resolve(false):exports.isPDFiumSupported()).then(function(isSupported) {
                    if(isSupported && !me.docViewer.getWatermark()) {
                        var current_document = me.docViewer.getDocument();
                        if (!current_document || me.printInProgress) {
                            return;
                        }

                        var printButton = $('#printButton');

                        me.printInProgress = true;
                        me.printCancelled = false;
                        printButton.removeClass('print');
                        printButton.addClass('refresh');
                        printButton.addClass('rotate-icon');
                        var endLoading = function() {
                            me.printInProgress = false;
                            printButton.removeClass('refresh');
                            printButton.removeClass('rotate-icon');
                            printButton.addClass('print');
                        };


                        var annotManager = me.docViewer.getAnnotationManager();
                        var options = {"xfdfString": annotManager.exportAnnotations(), "printDocument": true};
                        if(!me.printCancelled) {
                            current_document.getFileData(options).then(function (data) {
                                endLoading();
                                console.log("Print check");
                                if(!me.printCancelled) {
                                    var arr = new Uint8Array(data);
                                    var blob = new Blob([arr], {
                                        type: 'application/pdf'
                                    });
                                    console.log("Finished printing");
                                    exports.pdfiumPrint(blob);
                                }
                            },
                            function onDownloadFailed() {
                                endLoading();
                                console.log("Print Cancelled");
                                if(!me.printCancelled) {
                                    //revert to basic printing
                                    exports.DesktopReaderControl.prototype.printHandler.call(me);
                                }


                            });
                        }

                    }
                    else {
                        exports.DesktopReaderControl.prototype.printHandler.call(me);
                    }
                });
            }
            else {
                exports.DesktopReaderControl.prototype.printHandler.call(me);
            }
        },

        listener: function (e) {
            var files = e.target.files;
            if (files.length === 0) {
                return;
            }
            this.loadLocalFile(files[0], {
                filename: this.parseFileName(document.getElementById('input-pdf').value)
            });
        },

        closeDocument: function() {
            exports.DesktopReaderControl.prototype.closeDocument.call(this);
            this.$progressBar.removeClass('document-failed');
            this.$progressBar.hide();
        }
    };

    exports.ReaderControl.prototype = $.extend({}, exports.DesktopReaderControl.prototype, exports.ReaderControl.prototype);

})(window);

$('#slider').addClass('hidden-lg');
$('#searchControl').parent().addClass('hidden-md');
$('#control').css('min-width', 720);
$('head').append($('<link rel="stylesheet" type="text/css" />').attr('href', 'pdf/PDFReaderControl.css'));

//# sourceURL=PDFReaderControl.js