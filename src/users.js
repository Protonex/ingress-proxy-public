var fs           = require('fs'),
    crypto       = require('crypto'),
    googleapis   = require('googleapis'),
    OAuth2Client = googleapis.OAuth2Client,
    oauth2client = new OAuth2Client('***', '**', 'postmessage'),
    redirect_url = oauth2client.generateAuthUrl({
        scope: 'https://www.googleapis.com/auth/plus.login'
    }),
    plusClient  = null;

googleapis.discover('plus', 'v1').execute(function (err, client) {
    if (!err) plusClient = client;
})



function Users() {
    this.allowedUsers = [];
    this.users = this.loadUsers();
    Object.keys(this.users).forEach(function (id) {
        if (this.users[id].allowed) {
            this.grantAccess(id);
        }
    }, this);
}
module.exports = Users;


Users.prototype.isAllowed = function (ip) {
    return this.allowedUsers.indexOf(ip) > -1;
};

Users.prototype.loadUsers = function () {
    var users = null;
    try {
        users = JSON.parse(fs.readFileSync('./users.json'));
    } catch (e) {
        users = {};
    }
    return users;
};

Users.prototype.saveUsers = function () {
    fs.writeFileSync('./users.json', JSON.stringify(this.users, null, 4));
};

Users.prototype.getUser = function (cookie) {
    for (var user in this.users) {
        if (this.users[user].cookie === cookie) {
            return this.users[user];
        }
        return null;
    }
};

Users.prototype.grantAccess = function (id) {
    var user = this.users[id];
    user.allowed = true;
    this.allowedUsers = this.allowedUsers.concat(user.ips);
    this.saveUsers();
};

Users.prototype.getUserProfile = function (ip, response, err, tokens) {
    var user = { tokens: tokens, ips: [ip], allowed: false };
    oauth2client.credentials = tokens;
    plusClient
        .plus.people.get({ userId: 'me' })
        .withAuthClient(oauth2client)
        .execute(this.saveUser.bind(this, user, response));
};

Users.prototype.saveUser = function (newUser, response, err, profile) {
    var date = new Date();
    date.setDate(date.getDate() + 365);

    if (!this.users[profile.id]) {
        newUser.profile = profile;
        this.users[profile.id] = newUser;

        this.generateCookieKey(newUser.ips, function (cookie) {
            this.users[profile.id].cookie = cookie;
            this.authResponse(response, newUser, {
                'Set-Cookie': 'session=' + cookie + ';expires=' + date.toUTCString() + ';'
            });
        }.bind(this));

    } else {
        var user = this.users[profile.id];
        user.tokens = newUser.tokens;
        if (user.ips.indexOf(newUser.ips[0]) === -1) {
            user.ips = user.ips.concat(newUser.ips);
        }
        this.authResponse(response, user, {
            'Set-Cookie': 'session=' + user.cookie + ';expires=' + date.toUTCString() + ';'
        });
    }
};

Users.prototype.authResponse = function (response, user, cookie) {
    response.writeHead(200, cookie);
    response.end(String(user.allowed));
    this.saveUsers();
};

Users.prototype.generateCookieKey = function (ips, callback) {
    var shasum = crypto.createHash('sha1');
    shasum.update(new Buffer(Date.now() + String(ips)));
    crypto.randomBytes(256, function (err, buffer) {
        shasum.update(buffer);
        callback(shasum.digest('hex'));
    });
};

Users.prototype.getCookie = function (cookies) {
    if (!cookies) {
        return null;
    }
    var parts = cookies.split(' ');
    var cookie = parts.filter(function (cookie) {
        return cookie.indexOf('session=') > -1;
    });
    return cookie[0] ? cookie[0].split('=')[1] : null;
};

Users.prototype.allowIP = function (user, ip) {
    if (user.allowed && !this.isAllowed(ip)) {
        user.ips.push(ip);
        this.grantAccess(user.profile.id);
    }
}

Users.prototype.handleSettings = function (ip, url, request, response) {
    switch (url.pathname) {
        case '/':
            this.respond(ip, request, response);
        break;
        case '/setAuth':
            this.setAuth(ip, request, response);
        break;
        default:
            response.writeHead(403, 'YOU SHALL NOT PASS!!!');
            response.end();
    }
};

Users.prototype.respond = function (ip, request, response) {
    var cookie = this.getCookie(request.headers.cookie),
        user   = null,
        file   = '';
    if (cookie) {
        user = this.getUser(cookie);
        if (user) {
            this.allowIP(user, ip);
        }
    }
    if (user && user.allowed) {
        file = './templates/loggedin.html';
    } else {
        file = './templates/index.html';
    }
    if (file) {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        fs.createReadStream(file).pipe(response);
    } else {
        response.writeHead(404);
        response.end();
    }
};

Users.prototype.setAuth = function (ip, request, response) {
    var code = '';
    request.on('data', function (chunk) { code += chunk});
    request.on('end', function () {
        var callback = this.getUserProfile.bind(this, ip, response);
        oauth2client.getToken(code, callback);
    }.bind(this));
};
