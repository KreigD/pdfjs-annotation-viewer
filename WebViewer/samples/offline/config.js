(function() {

    if (!(Modernizr.indexeddb || Modernizr.websqldatabase)) {
        alert('This browser does not support offline mode!');
    }

})();