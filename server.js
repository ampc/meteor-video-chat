import {Meteor} from 'meteor/meteor';
import {Random} from 'meteor/random';
import {Accounts} from 'meteor/accounts-base';
const key = Random.secret();

Accounts.onLogin(function(data) {
  Meteor.users.update({
    _id: data.user._id
  }, {
    $set: {
      connection: data.connection.id,
      'profile.online': false,
      'profile.idle': false,
      'profile.location.ip': data.connection.clientAddress,
      'profile.lastLogin': new Date()
    }
  });
});
Accounts.onLogout(function(data) {
  Meteor.users.update({
    _id: data.user._id
  }, {
    $set: {
      connection: data.connection.id,
      'profile.online': false,
      'profile.idle': false,
      'profile.location.ip': data.connection.clientAddress
    }
  });
});
Meteor.onConnection(function(connection) {
  var connectionId;
  connectionId = connection.id;
  connection.onClose(function() {
    Meteor.users.update({
      connection: connectionId
    }, {
      $set: {
        'profile.online': false,
        'profile.idle': false
      }
    });
  });
});