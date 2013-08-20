var http         = require('http'),
    URL          = require('url'),
    util         = require('util'),
    EventEmitter = require('events').EventEmitter,
    Proxy        = require('./src/proxy.js'),
    Users        = require('./src/users.js'),
    proxy        = null,
    users        = null,
    server       = null,
    ingress      = null,
    ownHostnames = [
        '192.168.178.65'
    ],
    blockedHosts = [
        'ssl.google-analytics.com',
        'googleads.g.doubleclick.net'
    ],
    allowedHosts = [
        'apis.google.com',
        'plusone.google.com',
        'ssl.gstatic.com',
        'accounts.google.com',
        'accounts.google.de',
        'oauth.googleusercontent.com',
        'android.clients.google.com'
    ];

allowedHosts = allowedHosts.concat(ownHostnames);



function IngressRewrites() {
    EventEmitter.call(this);

    this.inventory = {};
    this.playerEntity = {};

    this.hacksCollected = [];
    this.hackResponse = null;
    this.numHacks = 20;
}
util.inherits(IngressRewrites, EventEmitter);


IngressRewrites.prototype.collectItemsFromPortal = function (url, data, callback) {
    if (data.type === 'request') {
        this.hacksCollected = [];
        this.hackResponse = null;
        for (var i = 0; i < this.numHacks; i += 1) {
            callback('request', data);
        }
    } else if (data.type === 'response') {
        var body = JSON.parse(data.body);
        this.hacksCollected.push(body);
        if (!body.error && !this.hackResponse) {
            this.hackResponse = body;
        }
        if (this.hacksCollected.length === this.numHacks) {
            this.accumulateHackResults(data, callback);
        }
    }
};

IngressRewrites.prototype.accumulateHackResults = function () {
    var response = this.hackResponse || this.hacksCollected[0];
    if (!response.error) {
        response.result.addedGuids = [];
        response.gameBasket.inventory = [];
    }
    this.hacksCollected.forEach(function (result) {
        if (!result.error) {
            response.result.addedGuids = response.result.addedGuids.concat(result.result.addedGuids);
            response.gameBasket.inventory = response.gameBasket.inventory.concat(result.gameBasket.inventory);
        }
    });
    data.body = JSON.stringify(response);
    console.log('multihack done');
    callback('response', data);
};

IngressRewrites.prototype.deployResonatorV2 = function (url, data, callback) {
    // use highest resonator instead of lowest first
    // data.body.itemGuids[0] = inventory.responators.pop();
    callback('request', data);
};

IngressRewrites.prototype.handshake = function (url, data, callback) {
    if (data.type === 'request') {
        callback('request', data);
    } else if (data.type === 'response') {
        console.log(data);
        callback('response', data);
    }
};




ingress = new IngressRewrites();
users   = new Users();
proxy   = new Proxy({
    'm-dot-betaspike.appspot.com/handshake': ingress.handshake.bind(ingress),
    'm-dot-betaspike.appspot.com/rpc/gameplay/collectItemsFromPortal': ingress.collectItemsFromPortal.bind(ingress)
});


server = http.createServer(function (req, res) {
    var url           = URL.parse(req.url),
        ip            = req.connection.remoteAddress,
        isLocalURL    = url.href.indexOf('/') === 0,
        isSettingsURL = ownHostnames.indexOf(url.hostname) > -1 || isLocalURL,
        isAllowedUser = users.isAllowed(ip),
        isAllowedHost = allowedHosts.indexOf(url.hostname) > -1 || isLocalURL,
        isBlockedHost = blockedHosts.indexOf(url.hostname) > -1,
        isAllowed     = !isBlockedHost && (isAllowedUser || isAllowedHost);


    if (isAllowed) {
        if (isSettingsURL) {
            users.handleSettings(ip, url, req, res);
        } else {
            proxy.handleRequest(req, res);
        }
    } else {
        console.log('[HTTP] denied access to', url.hostname);
        res.writeHead(403, 'YOU SHALL NOT PASS!!!');
        res.end();
    }
}).listen(8080);

server.on('connect', function (req, socket, head) {
    var url           = URL.parse('https://' + req.url),
        ip            = req.connection.remoteAddress,
        isAllowedUser = users.isAllowed(ip),
        isAllowedHost = allowedHosts.indexOf(url.hostname) > -1,
        isBlockedHost = blockedHosts.indexOf(url.hostname) > -1,
        isAllowed     = !isBlockedHost && (isAllowedUser || isAllowedHost);

    if (isAllowed) {
        proxy.handleConnect(req, socket, head);
    } else {
        console.log('[HTTPS] denied access to', req.url);
        socket.end('HTTP/1.1 403 YOU SHALL NOT PASS!!!');
    }
});