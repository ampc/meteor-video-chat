import {
    Meteor
}
from 'meteor/meteor';
import {
    Tracker
}
from 'meteor/tracker'

if (Meteor.isServer) {
    /*
     * Statuses
     * New - N
     * Accepted - C
     * Ignored - I 
     */
    Meteor.methods({
        "VideoChat/Call" (targets) {
            let mvc_arr_usr = [];
            let sts_dt;
            targets.forEach(usr => {
                //Shitty hack to ensure that each user has a unique time
                // if (!usr) throw new Meteor.Error(500, "Null user found");
                sts_dt = sts_dt ? sts_dt + 1 : new Date().getTime();
                mvc_arr_usr.push({
                    usr,
                    sts_dt: new Date(sts_dt),
                    sts: usr === Meteor.userId() ? "C" : "N"
                });
            });

            Meteor.VideoChat.collection.insert({
                mvc_arr_usr,
                mvc_dt_crt: new Date(),
                mvc_bol_sts: true
            })
            return targets;
        },
        "VideoChat/UserOnline" () {
            Meteor.users.update({
                _id: Meteor.userId()
            }, {
                'profile.video_chat': true,
                'profile.online': true,
                'profile.idle': false
            });
        },
        "VideoChat/SendData" (type, data, target) {
            Meteor.VideoChat.data_channel.insert({
                target,
                data,
                type,
                sender: this.userId
            });
        },
        "VideoChat/UpdateDataChannel" (_id) {
            Meteor.VideoChat.data_channel.remove({
                _id,
                target: Meteor.userId()
            });
        }
    });
    Meteor.publish("video_chat", function() {
        return Meteor.VideoChat.collection.find({
            mvc_bol_sts: true,
            mvc_arr_usr: {
                $elemMatch: {
                    usr: this.userId,
                    $or: [{
                        sts: "N"
                    }, {
                        sts: "C"
                    }]
                }
            }
        });
    });
    Meteor.publish("video_chat_data", function() {
        const dataCursor = Meteor.VideoChat.data_channel.find({
            target: this.userId,
            status: "N"
        });
        Meteor.VideoChat.data_channel.remove({
            _id: dataCursor.fetch()._id
        });
        return dataCursor;
    });
}


Meteor.VideoChat = new class {

    constructor() {
        this.collection = new Meteor.Collection("VideoChat");
        this.data_channel = new Meteor.Collection("DataChannel");
        this.sub = undefined;
        this.dataSub = undefined;
        this.tracker = undefined;
        this.connections = {};
        this.stream = undefined;
        this.currentCall = undefined;
        this.STUNTURN = [{
            url: 'stun:stun01.sipphone.com'
        }, {
            url: 'stun:stun.ekiga.net'
        }, {
            url: 'stun:stun.fwdnet.net'
        }, {
            url: 'stun:stun.ideasip.com'
        }, {
            url: 'stun:stun.iptel.org'
        }, {
            url: 'stun:stun.rixtelecom.se'
        }, {
            url: 'stun:stun.schlund.de'
        }, {
            url: 'stun:stun.l.google.com:19302'
        }, {
            url: 'stun:stun1.l.google.com:19302'
        }, {
            url: 'stun:stun2.l.google.com:19302'
        }, {
            url: 'stun:stun3.l.google.com:19302'
        }, {
            url: 'stun:stun4.l.google.com:19302'
        }, {
            url: 'stun:stunserver.org'
        }, {
            url: 'stun:stun.softjoys.com'
        }, {
            url: 'stun:stun.voiparound.com'
        }, {
            url: 'stun:stun.voipbuster.com'
        }, {
            url: 'stun:stun.voipstunt.com'
        }, {
            url: 'stun:stun.voxgratia.org'
        }, {
            url: 'stun:stun.xten.com'
        }, {
            url: 'turn:numb.viagenie.ca',
            credential: 'muazkh',
            username: 'webrtc@live.com'
        }, {
            url: 'turn:192.158.29.39:3478?transport=udp',
            credential: 'JZEOEt2V3Qb0y27GRntt2u2PAYA=',
            username: '28224511:1379330808'
        }, {
            url: 'turn:192.158.29.39:3478?transport=tcp',
            credential: 'JZEOEt2V3Qb0y27GRntt2u2PAYA=',
            username: '28224511:1379330808'
        }];
    }
    init() {
        this.tracker = Tracker.autorun(() => {
            this.dataSub = Meteor.subscribe("video_chat_data");
            this.sub = Meteor.subscribe("video_chat");
            try {
                const incomingCall = this.collection.findOne({
                    "mvc_arr_usr.usr": Meteor.userId(),
                    $or: [{
                        "mvc_arr_usr.sts": "N",
                        "mcv_arr_usr.sts": "C"
                    }]
                });
                if (incomingCall) {
                    return this.incomingCall(incomingCall);
                }
            }
            catch (e) {
                console.log(e);
            }
            this.stream = Meteor.connection._stream.on('message', message => {
                message = JSON.parse(message);
                console.log(message);
                if (message.msg == "changed" && message.collection == "VideoChat" && message.fields != undefined) {
                    if (message.fields.mvc_arr_usr) {
                        this.currentCall = message._id;
                        this.updateConnections(message.fields);
                    }
                }
                if (message.msg == "removed" && message.collection == "VideoChat") {
                    if (message._id == this.currentCall)
                        this.endCall();
                }
                if (message.msg == "added" && message.collection == "VideoChat") {
                    if (message.fields.mvc_arr_usr) {
                        this.updateConnections(message.fields);
                    }
                }
                if (message.msg == "added" && message.collection == "VideoChatData" && message.fields != undefined) {
                    const fields = message.fields;
                    Meteor.call("VideoChat/UpdateDataChannel", fields._id, err => {
                        if (err) return console.log(err);
                        switch (fields.type) {
                            case "SDP":
                                this.setSDP(message.fields);
                                break;
                            case "ICE":

                                break;
                        }
                    });
                }

            });
        });

        Meteor.call("VideoChat/UserOnline");
    }

    kill() {
        this.connections = {};
        this.tracker = undefined;
        this.sub = undefined;
        this.dataSub = undefined;
    }
    updateConnections(fields) {
        let self = this;
        fields.mvc_arr_usr.forEach(usr => {
            if (self.connections[usr.usr]) {
                self.connections[usr.usr].sts_dt = usr.sts_dt;
                self.connections[usr.usr].sts = usr.sts;
            }
            else
                self.connections[usr.usr] = usr;
        });
    }
    endCall() {
        this.currentCall = undefined;
        this.connections = {};
        this.onEndCall();
    }
    call(users) {
        Meteor.call("VideoChat/Call", users, (err, targets) => {
            if (err) return console.log(err);
            targets.forEach(target => this.connections[target] = target)
        });
    }
    setSDP(fields) {

        if (this.connections[Meteor.userId()].sts_dt < this.connections[fields.target].sts_dt) {
            this.connections[Meteor.userId()].connection.setRemoteDescription(fields.data, function() {

            }, function() {

            });
        }
        else {
            this.connections[Meteor.userId()].connection = new RTCPeerConnection(this.STUNTURN);
            this.connections[Meteor.userId()].connection.setRemoteDescription(fields.data, function() {

            }, function() {

            });

        }

    }


};
