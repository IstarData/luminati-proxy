// LICENSE_CODE ZON ISC
'use strict'; /*jslint node:true, browser:true*/
(function(){
var define;
var is_node_ff = typeof module=='object' && module.exports;
if (!is_node_ff)
    define = self.define;
else
    define = require('./require_node.js').define(module, '../');
define(['jquery', '/util/etask.js', '/util/date.js', '/util/escape.js',
    '/util/zerr.js', 'events'],
    function($, etask, date, zescape, zerr, events){
var assign = Object.assign;
var E = function(){ return E.send.apply(this, arguments); };

E.send = function(opt){
    var timeout = typeof opt.timeout=='number' ? opt.timeout : 20*date.ms.SEC;
    var slow = opt.slow||2*date.ms.SEC;
    var retry = opt.retry, data = opt.data, qs = zescape.qs(opt.qs);
    var url = zescape.uri(opt.url, qs), perr = opt.perr;
    // opt.type is deprecated
    var method = opt.method||opt.type||'GET';
    var data_type = opt.json ? 'json' : 'text';
    var t0 = Date.now();
    var ajopt, xhr;
    zerr.debug('ajax('+data_type+') url '+url+' retry '+retry);
    return etask([function(){
        ajopt = {type: method, url: url, headers: assign({}, opt.headers),
            dataType: data_type, data: data, timeout: timeout, xhrFields: {}};
        if (opt.content_type)
            ajopt.contentType = opt.content_type;
        if (opt.with_credentials)
            ajopt.xhrFields.withCredentials = true;
        if (opt.onprogress)
            ajopt.xhrFields.onprogress = opt.onprogress;
        if (opt.onuploadprogress)
        {
            ajopt.xhr = function(){
                var _xhr = $.ajaxSettings.xhr();
                _xhr.upload.onprogress = opt.onuploadprogress;
                return _xhr;
            };
        }
        if (opt.multipart)
        {
            ajopt.contentType = false;
            ajopt.processData = false;
            delete ajopt.dataType;
        }
        if (opt.async!==undefined)
            ajopt.async = opt.async;
        E.ajopt_modifiers.forEach(function(modifier){
            modifier(ajopt); });
        xhr = $.ajax(ajopt);
        var _this = this;
        xhr.done(function(v){
            if (opt.restore_dates && v && typeof v=='object')
                E.restore_dates(v);
            _this.continue(v);
        });
        xhr.fail(function(_xhr, status_text, err){
            if (data_type=='json' && _xhr && _xhr.status==200 &&
                ['', 'ok', 'OK'].includes(_xhr.responseText))
            {
                _this.continue(null);
                return;
            }
            if (!err && _xhr && _xhr.responseText && !_xhr.responseJSON)
                err = _xhr.responseText;
            _this.throw(err instanceof Error ? err : new Error(''+err));
        });
        return this.wait();
    }, function catch$(err){
        xhr = xhr||{};
        zerr('ajax('+data_type+') failed url '+url+' data '+
            zerr.json(data).substr(0, 200)+' status: '+xhr.status+' '+
            xhr.statusText+'\nresponseText: '+
            (xhr.responseText||'').substr(0, 200));
        if (retry && (!opt.should_retry||opt.should_retry(err, xhr, ajopt)))
            return this.return(E.send(assign({}, opt, {retry: retry-1})));
        if (xhr.statusText=='timeout')
            E.events.emit('timeout', this);
        if (xhr.status==403)
            E.events.emit('unauthorized', this, xhr);
        if (xhr.status==406)
            E.events.emit('maintenance', this, xhr);
        if (xhr.status==500)
            E.events.emit('unhandledException', this, xhr);
        var xhr_data = get_res_data(xhr);
        if (opt.restore_dates && xhr_data && typeof xhr_data=='object')
            E.restore_dates(xhr_data);
        if (opt.no_throw)
        {
            return {
                err: err,
                url: url,
                method: method,
                status: +xhr.status || 0,
                data: xhr_data,
                xhr: xhr,
                // legacy
                error: xhr.statusText||'no_status', message: xhr.responseText,
            };
        }
        err.xhr_info = {url: url, method: method, status: xhr.status,
            data: xhr_data, response_text: xhr.responseText};
        err.x_error = xhr.getResponseHeader('X-Luminati-Error') ||
            xhr.getResponseHeader('X-Hola-Error');
        throw err;
    }, function(_data){
        var res, t = Date.now()-t0;
        zerr[t>slow ? 'err' : 'debug'](
            'ajax('+data_type+') '+(t>slow ? 'SLOW ' : 'ok ')+t+'ms url '+url);
        if (t>slow && perr)
            perr({id: 'be_ajax_slow', info: t+'ms '+url});
        if (E.do_op)
            E.do_op(_data&&_data.do_op);
        if (Array.isArray(opt.return_headers))
        {
            res = {
                data: _data,
                headers: opt.return_headers.reduce(function(obj, h){
                    obj[h] = xhr.getResponseHeader(h);
                    return obj;
                }, {}),
            };
        }
        else
            res = _data;
        return this.return(res);
    }, function abort(){
        // reachable only via E.abort
        xhr.abort();
    }]);
};

E.abort = function(aj){ aj.goto('abort'); };

['GET', 'POST', 'PUT', 'DELETE'].forEach(function(m){
    E[m.toLowerCase()] = function(url, params, opt){
        url = typeof url=='string' ? {url: url} : url;
        var send_opt = assign({method: m, json: 1}, url, params, opt);
        if (!{get: 1, delete: 1}[send_opt.method.toLowerCase()]
            && send_opt.data!=null && typeof send_opt.data!='string')
        {
            send_opt.content_type = send_opt.content_type||'application/json';
            if (send_opt.content_type.startsWith('application/json'))
                send_opt.data = JSON.stringify(send_opt.data);
        }
        return E.send(send_opt);
    };
});

E.json = function(opt){ return E.send(assign({}, opt, {json: 1})); };

E.events = new events.EventEmitter();

E.ajopt_modifiers = [];

// -- internal utils ---

function get_res_data(xhr){
    if (xhr.responseJSON!=null && xhr.responseJSON!=='')
        return xhr.responseJSON;
    var content_type = xhr.getResponseHeader('content-type')||'';
    if (xhr.responseText && content_type.includes('application/json'))
    {
        try { return JSON.parse(xhr.responseText); }
        catch(e){ }
    }
    return xhr.responseText||'';
}

E.restore_dates = function(data){
    if (!data || typeof data!='object')
        return;
    var stack = new Array(100), len = 0;
    stack[len++] = data;
    while (len>0)
    {
        var obj = stack[--len];
        for (var k in obj)
        {
            var v = obj[k];
            if (typeof v=='string')
            {
                var strlen = v.length;
                if (strlen>=20 && strlen<30 && date_rx.test(v))
                    obj[k] = new Date(v);
            }
            else if (typeof v=='object' && v!=null)
            {
                if (!v.constructor || v.constructor==Object)
                    stack[len++] = v;
                else if (v.length && Array.isArray(v))
                    stack[len++] = v;
            }
        }
    }
};
var date_rx = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+([+-]\d{2}:\d{2}|Z)$/;

return E; }); }());
