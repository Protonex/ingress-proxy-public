var http  = require('http'),
    https = require('https'),
    net   = require('net'),
    zlib  = require('zlib'),
    URL   = require('url');


http.globalAgent.maxSockets = 1000;
https.globalAgent.maxSockets = 1000;

function Proxy(routes) {
    this.routes = routes;
}

module.exports = Proxy;


Proxy.prototype.proxyRequest = function (options, userRequest, userResponse) {
    var proxyRequest = http.request(options, function (proxyResponse) {
        var url = URL.parse(proxyResponse.url);
        console.log('[HTTP]  <  response from:', options.host + options.path);
        userResponse.writeHead(proxyResponse.statusCode, proxyResponse.headers);
        proxyResponse.pipe(userResponse);
    });
    userRequest.pipe(proxyRequest);
    proxyRequest.on('error', function (err) {
        console.error('[HTTP] ERROR: Error while requesting:', userRequest.url, err);
    });
};


Proxy.prototype.handleRequest = function (userRequest, userResponse) {
    var url = URL.parse(userRequest.url),
        route = this.routes[url.host + url.pathname],
        options = {
                host: url.hostname,
                port: url.port || 80,
                method: userRequest.method,
                path: url.path,
                agent: userRequest.agent,
                auth: userRequest.auth,
                headers: userRequest.headers
            };

    console.log('[HTTP]  >  request to:', url.host + url.pathname);

    if (typeof route === 'undefined') {
        this.proxyRequest(options, userRequest, userResponse);
    } else {
        console.log('[HTTP]  Found route for:', url.host);
        this.callRouteWithData(route, url, options, userRequest, userResponse);
    }
};


Proxy.prototype.getBody = function (reqest_response, callback) {
    var body = '',
        gunzip = null,
        stream = reqest_response;

        if (reqest_response.headers['content-encoding'] === 'gzip') {
            delete reqest_response.headers['content-encoding'];
            gunzip = zlib.createGunzip();
            stream = gunzip;
            reqest_response.pipe(gunzip);
        }

        stream.on('data', function (chunk) { body += chunk; });
        stream.on('end', function () {
            callback(body);
        });
};


Proxy.prototype.handleResponse = function (userResponse, route, response) {
    this.getBody(response, function (body) {
        var data = {
                type: 'response',
                head: {
                    statusCode: response.statusCode,
                    headers: response.headers
                },
                body: body
            },
            url = URL.parse(response.req._headers.host + response.req.path);

            console.log('[HTTP]  <  response from:', url.host + url.pathname);

        route(url, data, this.execute.bind(this, userResponse, route));
    }.bind(this));
};


Proxy.prototype.callRouteWithData = function (route, url, options, userRequest, userResponse) {
    this.getBody(userRequest, function (body) {
        var data = { type: 'request', options: options, body: body };

        route(url, data, this.execute.bind(this, userResponse, route));
    }.bind(this));
};


Proxy.prototype.execute = function (userResponse, route, type, data) {
    switch (type) {
        case 'request':
            var url = URL.parse(data.options.host + data.options.path);
            console.log('[HTTP]  >  request to:', url.pathname);
            data.options.headers['content-length'] = data.body.length;
            http.request(data.options, this.handleResponse.bind(this, userResponse, route)).end(data.body);
        break;
        case 'response':
            data.head.headers['content-length'] = data.body.length;
            userResponse.writeHead(data.head.statusCode, data.head.headers);
            userResponse.write(data.body);
            userResponse.end();
    }
};


Proxy.prototype.handleConnect = function (request, socketRequest, bodyHead) {
    var url         = URL.parse('https://' + request.url),
        httpVersion = request.httpVersion,
        proxySocket = new net.Socket();


    console.log('[HTTPS] >  CONNECT:', url.hostname);


    proxySocket.connect(url.port, url.hostname, function () {
        console.log('[HTTPS] <> connected pipe:', url.hostname);
        proxySocket.write(bodyHead);
        socketRequest.write('HTTP/' + httpVersion + ' 200 Connection established\r\n\r\n');
    });

    proxySocket.pipe(socketRequest);
    proxySocket.on('error', function (err) {
        console.error('[HTTPS] ERROR: Error establishing socket connection to host:', url.hostname, err);
        socketRequest.end('HTTP/' + httpVersion + ' 500 Connection error\r\n\r\n');
    });


    socketRequest.pipe(proxySocket);
    socketRequest.on('error', function (err) {
        console.error('[HTTPS] ERROR: Error establishing socket connection with client', err);
        proxySocket.end();
    });
};