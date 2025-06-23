
/**
 * Starting point for interacting with the WhatsApp Web API
 * @param {object} options - Client options
 * @fires Client#qr
 * @fires Client#authenticated
 * @fires Client#auth_failure
 * @fires Client#ready
 * @fires Client#message
 * @fires Client#message_ack
 * @fires Client#message_create
 * @fires Client#message_revoke_me
 * @fires Client#message_revoke_everyone
 * @fires Client#message_ciphertext
 * @fires Client#message_edit
 * @fires Client#media_uploaded
 * @fires Client#group_join
 * @fires Client#group_leave
 * @fires Client#group_update
 * @fires Client#disconnected
 * @fires Client#change_state
 * @fires Client#contact_changed
 * @fires Client#group_admin_changed
 * @fires Client#group_membership_request
 * @fires Client#vote_update
 */

const Events = {
    MESSAGE_CREATE: 'message_create',
    MESSAGE_RECEIVED: 'message_received',
    MESSAGE_ACK: 'message_ack',
    MESSAGE_CIPHERTEXT: 'message_ciphertext',
    MESSAGE_EDIT: 'message_edit',
};
class Client {
    constructor() { }

    emit(event, ...args) {
        window.postMessage({
            type: 'NEW_WHATSAPP_MESSAGE',
            payload: { event, args }
        }, '*');
    }

    /**
     * Attach event listeners to WA Web
     * Private function
     */
    async attachEventListeners() {
        const onAddMessageEvent = msg => {
            if (msg.type === 'gp2') {
                if (['add', 'invite', 'linked_group_join'].includes(msg.subtype)) {
                    this.emit(Events.GROUP_JOIN, msg);
                } else if (msg.subtype === 'remove' || msg.subtype === 'leave') {
                    this.emit(Events.GROUP_LEAVE, msg);
                } else if (msg.subtype === 'promote' || msg.subtype === 'demote') {
                    this.emit(Events.GROUP_ADMIN_CHANGED, msg);
                } else if (msg.subtype === 'membership_approval_request') {
                    this.emit(Events.GROUP_MEMBERSHIP_REQUEST, msg);
                } else {
                    this.emit(Events.GROUP_UPDATE, msg);
                }
                return;
            }

            this.emit(Events.MESSAGE_CREATE, msg);

            if (msg.id.fromMe) return;

            this.emit(Events.MESSAGE_RECEIVED, msg);
        };

        let last_message;

        const onChangeMessageTypeEvent = (msg) => {
            if (msg.type === 'revoked') {
                let revoked_msg;
                if (last_message && msg.id.id === last_message.id.id) {
                    revoked_msg = last_message;
                }
                this.emit(Events.MESSAGE_REVOKED_EVERYONE, msg, revoked_msg);
            }
        };

        const onChangeMessageEvent = (msg) => {
            if (msg.type !== 'revoked') {
                last_message = msg;
            }

            const isParticipant = msg.type === 'gp2' && msg.subtype === 'modify';
            const isContact = msg.type === 'notification_template' && msg.subtype === 'change_number';

            if (isParticipant || isContact) {
                const newId = isParticipant ? msg.recipients[0] : msg.to;
                const oldId = isParticipant ? msg.author : msg.templateParams.find(id => id !== newId);
                this.emit(Events.CONTACT_CHANGED, msg, oldId, newId, isContact);
            }
        };

        const onRemoveMessageEvent = (msg) => {
            if (!msg.isNewMsg) return;
            this.emit(Events.MESSAGE_REVOKED_ME, msg);
        };

        const onMessageAckEvent = (msg, ack) => {
            this.emit(Events.MESSAGE_ACK, msg, ack);
        };

        const onChatUnreadCountEvent = async (data) => {
            this.emit(Events.UNREAD_COUNT, data);
        };

        const onMessageMediaUploadedEvent = (msg) => {
            this.emit(Events.MEDIA_UPLOADED, msg);
        };

        const onAppStateChangedEvent = async (state) => {
            this.emit(Events.STATE_CHANGED, state);
        };

        const onBatteryStateChangedEvent = (state) => {
            const { battery, plugged } = state;
            if (battery === undefined) return;
            this.emit(Events.BATTERY_CHANGED, { battery, plugged });
        };

        const onIncomingCall = (call) => {
            this.emit(Events.INCOMING_CALL, call);
        };

        const onReaction = (reactions) => {
            for (const reaction of reactions) {
                this.emit(Events.MESSAGE_REACTION, reaction);
            }
        };

        const onRemoveChatEvent = async (chat) => {
            this.emit(Events.CHAT_REMOVED, chat);
        };

        const onArchiveChatEvent = async (chat, currState, prevState) => {
            this.emit(Events.CHAT_ARCHIVED, chat, currState, prevState);
        };

        const onEditMessageEvent = (msg, newBody, prevBody) => {
            if (msg.type === 'revoked') {
                return;
            }
            this.emit(Events.MESSAGE_EDIT, msg, newBody, prevBody);
        };

        const onAddMessageCiphertextEvent = msg => {
            this.emit(Events.MESSAGE_CIPHERTEXT, msg);
        };

        const onPollVoteEvent = (vote) => {
            this.emit(Events.VOTE_UPDATE, vote);
        };

        window.Store.Msg.on('change', (msg) => { onChangeMessageEvent(window.WWebJS.getMessageModel(msg)); });
        window.Store.Msg.on('change:type', (msg) => { onChangeMessageTypeEvent(window.WWebJS.getMessageModel(msg)); });
        window.Store.Msg.on('change:ack', (msg, ack) => { onMessageAckEvent(window.WWebJS.getMessageModel(msg), ack); });
        window.Store.Msg.on('change:isUnsentMedia', (msg, unsent) => { if (msg.id.fromMe && !unsent) onMessageMediaUploadedEvent(window.WWebJS.getMessageModel(msg)); });
        window.Store.Msg.on('remove', (msg) => { if (msg.isNewMsg) onRemoveMessageEvent(window.WWebJS.getMessageModel(msg)); });
        window.Store.Msg.on('change:body change:caption', (msg, newBody, prevBody) => { onEditMessageEvent(window.WWebJS.getMessageModel(msg), newBody, prevBody); });
        window.Store.AppState.on('change:state', (_AppState, state) => { onAppStateChangedEvent(state); });
        window.Store.Conn.on('change:battery', (state) => { onBatteryStateChangedEvent(state); });
        window.Store.Call.on('add', (call) => { onIncomingCall(call); });
        window.Store.Chat.on('remove', async (chat) => { onRemoveChatEvent(await window.WWebJS.getChatModel(chat)); });
        window.Store.Chat.on('change:archive', async (chat, currState, prevState) => { onArchiveChatEvent(await window.WWebJS.getChatModel(chat), currState, prevState); });
        window.Store.Msg.on('add', (msg) => {
            if (msg.isNewMsg) {
                if (msg.type === 'ciphertext') {
                    msg.once('change:type', (_msg) => onAddMessageEvent(window.WWebJS.getMessageModel(_msg)));
                    onAddMessageCiphertextEvent(window.WWebJS.getMessageModel(msg));
                } else {
                    onAddMessageEvent(window.WWebJS.getMessageModel(msg));
                }
            }
        });
        window.Store.Chat.on('change:unreadCount', (chat) => { onChatUnreadCountEvent(chat); });
        window.Store.PollVote.on('add', async (vote) => {
            const pollVoteModel = await window.WWebJS.getPollVoteModel(vote);
            pollVoteModel && onPollVoteEvent(pollVoteModel);
        });

        if (window.compareWwebVersions(window.Debug.VERSION, '>=', '2.3000.1014111620')) {
            const module = window.Store.AddonReactionTable;
            const ogMethod = module.bulkUpsert;
            module.bulkUpsert = ((...args) => {
                onReaction(args[0].map(reaction => {
                    const msgKey = reaction.id;
                    const parentMsgKey = reaction.reactionParentKey;
                    const timestamp = reaction.reactionTimestamp / 1000;
                    const sender = reaction.author ?? reaction.from;
                    const senderUserJid = sender._serialized;

                    return { ...reaction, msgKey, parentMsgKey, senderUserJid, timestamp };
                }));

                return ogMethod(...args);
            }).bind(module);
        } else {
            const module = window.Store.createOrUpdateReactionsModule;
            const ogMethod = module.createOrUpdateReactions;
            module.createOrUpdateReactions = ((...args) => {
                onReaction(args[0].map(reaction => {
                    const msgKey = window.Store.MsgKey.fromString(reaction.msgKey);
                    const parentMsgKey = window.Store.MsgKey.fromString(reaction.parentMsgKey);
                    const timestamp = reaction.timestamp / 1000;

                    return { ...reaction, msgKey, parentMsgKey, timestamp };
                }));

                return ogMethod(...args);
            }).bind(module);
        }
    }

    /**
     * Mark as seen for the Chat
     *  @param {string} chatId
     *  @returns {Promise<boolean>} result
     *
     */
    async sendSeen(chatId) {
        return await window.WWebJS.sendSeen(chatId);
    }

    /**
     * An object representing mentions of groups
     * @typedef {Object} GroupMention
     * @property {string} subject - The name of a group to mention (can be custom)
     * @property {string} id - The group ID, e.g.: 'XXXXXXXXXX@g.us'
     */

    /**
     * Message options.
     * @typedef {Object} MessageSendOptions
     * @property {boolean} [linkPreview=true] - Show links preview. Has no effect on multi-device accounts.
     * @property {boolean} [sendAudioAsVoice=false] - Send audio as voice message with a generated waveform
     * @property {boolean} [sendVideoAsGif=false] - Send video as gif
     * @property {boolean} [sendMediaAsSticker=false] - Send media as a sticker
     * @property {boolean} [sendMediaAsDocument=false] - Send media as a document
     * @property {boolean} [sendMediaAsHd=false] - Send image as quality HD
     * @property {boolean} [isViewOnce=false] - Send photo/video as a view once message
     * @property {boolean} [parseVCards=true] - Automatically parse vCards and send them as contacts
     * @property {string} [caption] - Image or video caption
     * @property {string} [quotedMessageId] - Id of the message that is being quoted (or replied to)
     * @property {GroupMention[]} [groupMentions] - An array of object that handle group mentions
     * @property {string[]} [mentions] - User IDs to mention in the message
     * @property {boolean} [sendSeen=true] - Mark the conversation as seen after sending the message
     * @property {string} [invokedBotWid=undefined] - Bot Wid when doing a bot mention like @Meta AI
     * @property {string} [stickerAuthor=undefined] - Sets the author of the sticker, (if sendMediaAsSticker is true).
     * @property {string} [stickerName=undefined] - Sets the name of the sticker, (if sendMediaAsSticker is true).
     * @property {string[]} [stickerCategories=undefined] - Sets the categories of the sticker, (if sendMediaAsSticker is true). Provide emoji char array, can be null.
     * @property {boolean} [ignoreQuoteErrors = true] - Should the bot send a quoted message without the quoted message if it fails to get the quote?
     * @property {MessageMedia} [media] - Media to be sent
     * @property {any} [extra] - Extra options
     */

    /**
     * Send a message to a specific chatId
     * @param {string} chatId
     * @param {string|MessageMedia|Location|Poll|Contact|Array<Contact>|Buttons|List} content
     * @param {MessageSendOptions} [options] - Options used when sending the message
     *
     * @returns {Promise<Message>} Message that was just sent
     */
    async sendMessage(chatId, content, options = {}) {
        const isChannel = /@\w*newsletter\b/.test(chatId);

        if (isChannel && [
            options.sendMediaAsDocument, options.quotedMessageId,
            options.parseVCards, options.isViewOnce,
            content instanceof Location, content instanceof Contact,
            content instanceof Buttons, content instanceof List,
            Array.isArray(content) && content.length > 0 && content[0] instanceof Contact
        ].includes(true)) {
            console.warn('The message type is currently not supported for sending in channels,\nthe supported message types are: text, image, sticker, gif, video, voice and poll.');
            return null;
        }

        if (options.mentions) {
            !Array.isArray(options.mentions) && (options.mentions = [options.mentions]);
            if (options.mentions.some((possiblyContact) => possiblyContact instanceof Contact)) {
                console.warn('Mentions with an array of Contact are now deprecated. See more at https://github.com/pedroslopez/whatsapp-web.js/pull/2166.');
                options.mentions = options.mentions.map((a) => a.id._serialized);
            }
        }

        options.groupMentions && !Array.isArray(options.groupMentions) && (options.groupMentions = [options.groupMentions]);

        let internalOptions = {
            linkPreview: options.linkPreview === false ? undefined : true,
            sendAudioAsVoice: options.sendAudioAsVoice,
            sendVideoAsGif: options.sendVideoAsGif,
            sendMediaAsSticker: options.sendMediaAsSticker,
            sendMediaAsDocument: options.sendMediaAsDocument,
            sendMediaAsHd: options.sendMediaAsHd,
            caption: options.caption,
            quotedMessageId: options.quotedMessageId,
            parseVCards: options.parseVCards !== false,
            mentionedJidList: options.mentions || [],
            groupMentions: options.groupMentions,
            invokedBotWid: options.invokedBotWid,
            ignoreQuoteErrors: options.ignoreQuoteErrors !== false,
            extraOptions: options.extra
        };

        const sendSeen = options.sendSeen !== false;

        if (content instanceof MessageMedia) {
            internalOptions.media = content;
            internalOptions.isViewOnce = options.isViewOnce,
                content = '';
        } else if (options.media instanceof MessageMedia) {
            internalOptions.media = options.media;
            internalOptions.caption = content;
            internalOptions.isViewOnce = options.isViewOnce,
                content = '';
        } else if (content instanceof Location) {
            internalOptions.location = content;
            content = '';
        } else if (content instanceof Poll) {
            internalOptions.poll = content;
            content = '';
        } else if (content instanceof Contact) {
            internalOptions.contactCard = content.id._serialized;
            content = '';
        } else if (Array.isArray(content) && content.length > 0 && content[0] instanceof Contact) {
            internalOptions.contactCardList = content.map(contact => contact.id._serialized);
            content = '';
        } else if (content instanceof Buttons) {
            console.warn('Buttons are now deprecated. See more at https://www.youtube.com/watch?v=hv1R1rLeVVE.');
            if (content.type !== 'chat') { internalOptions.attachment = content.body; }
            internalOptions.buttons = content;
            content = '';
        } else if (content instanceof List) {
            console.warn('Lists are now deprecated. See more at https://www.youtube.com/watch?v=hv1R1rLeVVE.');
            internalOptions.list = content;
            content = '';
        }

        if (internalOptions.sendMediaAsSticker && internalOptions.media) {
            internalOptions.media = await Util.formatToWebpSticker(
                internalOptions.media, {
                name: options.stickerName,
                author: options.stickerAuthor,
                categories: options.stickerCategories
            }, this.pupPage
            );
        }

        const sentMsg = await (async (chatId, content, options, sendSeen) => {
            const chat = await window.WWebJS.getChat(chatId, { getAsModel: false });

            if (!chat) return null;

            if (sendSeen) {
                await window.WWebJS.sendSeen(chatId);
            }

            const msg = await window.WWebJS.sendMessage(chat, content, options);
            return msg
                ? window.WWebJS.getMessageModel(msg)
                : undefined;
        })(chatId, content, internalOptions, sendSeen);

        return sentMsg
            ? new Message(this, sentMsg)
            : undefined;
    }

    /**
     * @typedef {Object} SendChannelAdminInviteOptions
     * @property {?string} comment The comment to be added to an invitation
     */

    /**
     * Sends a channel admin invitation to a user, allowing them to become an admin of the channel
     * @param {string} chatId The ID of a user to send the channel admin invitation to
     * @param {string} channelId The ID of a channel for which the invitation is being sent
     * @param {SendChannelAdminInviteOptions} options
     * @returns {Promise<boolean>} Returns true if an invitation was sent successfully, false otherwise
     */
    async sendChannelAdminInvite(chatId, channelId, options = {}) {
        const response = await (async (chatId, channelId, options) => {
            const channelWid = window.Store.WidFactory.createWid(channelId);
            const chatWid = window.Store.WidFactory.createWid(chatId);
            const chat = window.Store.Chat.get(chatWid) || (await window.Store.Chat.find(chatWid));

            if (!chatWid.isUser()) {
                return false;
            }

            return await window.Store.SendChannelMessage.sendNewsletterAdminInviteMessage(
                chat,
                {
                    newsletterWid: channelWid,
                    invitee: chatWid,
                    inviteMessage: options.comment,
                    base64Thumb: await window.WWebJS.getProfilePicThumbToBase64(channelWid)
                }
            );
        })(chatId, channelId, options);

        return response.messageSendResult === 'OK';
    }

    /**
     * Searches for messages
     * @param {string} query
     * @param {Object} [options]
     * @param {number} [options.page]
     * @param {number} [options.limit]
     * @param {string} [options.chatId]
     * @returns {Promise<Message[]>}
     */
    async searchMessages(query, options = {}) {
        const messages = await (async (query, page, count, remote) => {
            const { messages } = await window.Store.Msg.search(query, page, count, remote);
            return messages.map(msg => window.WWebJS.getMessageModel(msg));
        })(query, options.page, options.limit, options.chatId);

        return messages.map(msg => new Message(this, msg));
    }

    /**
     * Get all current chat instances
     * @returns {Promise<Array<Chat>>}
     */
    async getChats() {
        const chats = await (async () => {
            return await window.WWebJS.getChats();
        })();

        return chats.map(chat => ChatFactory.create(this, chat));
    }

    /**
     * Gets all cached {@link Channel} instance
     * @returns {Promise<Array<Channel>>}
     */
    async getChannels() {
        const channels = await (async () => {
            return await window.WWebJS.getChannels();
        })();

        return channels.map((channel) => ChatFactory.create(this, channel));
    }

    /**
     * Gets chat or channel instance by ID
     * @param {string} chatId
     * @returns {Promise<Chat|Channel>}
     */
    async getChatById(chatId) {
        const chat = await (async chatId => {
            return await window.WWebJS.getChat(chatId);
        })(chatId);
        return chat
            ? ChatFactory.create(this, chat)
            : undefined;
    }

    /**
     * Gets a {@link Channel} instance by invite code
     * @param {string} inviteCode The code that comes after the 'https://whatsapp.com/channel/'
     * @returns {Promise<Channel>}
     */
    async getChannelByInviteCode(inviteCode) {
        const channel = await (async (inviteCode) => {
            let channelMetadata;
            try {
                channelMetadata = await window.WWebJS.getChannelMetadata(inviteCode);
            } catch (err) {
                if (err.name === 'ServerStatusCodeError') return null;
                throw err;
            }
            return await window.WWebJS.getChat(channelMetadata.id);
        })(inviteCode);

        return channel
            ? ChatFactory.create(this, channel)
            : undefined;
    }

    /**
     * Get all current contact instances
     * @returns {Promise<Array<Contact>>}
     */
    async getContacts() {
        let contacts = await (() => {
            return window.WWebJS.getContacts();
        })();

        return contacts.map(contact => ContactFactory.create(this, contact));
    }

    /**
     * Get contact instance by ID
     * @param {string} contactId
     * @returns {Promise<Contact>}
     */
    async getContactById(contactId) {
        let contact = await (contactId => {
            return window.WWebJS.getContact(contactId);
        })(contactId);

        return ContactFactory.create(this, contact);
    }

    async getMessageById(messageId) {
        const msg = await (async messageId => {
            let msg = window.Store.Msg.get(messageId);
            if (msg) return window.WWebJS.getMessageModel(msg);

            const params = messageId.split('_');
            if (params.length !== 3 && params.length !== 4) throw new Error('Invalid serialized message id specified');

            let messagesObject = await window.Store.Msg.getMessagesById([messageId]);
            if (messagesObject && messagesObject.messages.length) msg = messagesObject.messages[0];

            if (msg) return window.WWebJS.getMessageModel(msg);
        })(messageId);

        if (msg) return new Message(this, msg);
        return null;
    }

    /**
     * Returns an object with information about the invite code's group
     * @param {string} inviteCode
     * @returns {Promise<object>} Invite information
     */
    async getInviteInfo(inviteCode) {
        return await (inviteCode => {
            return window.Store.GroupInvite.queryGroupInvite(inviteCode);
        })(inviteCode);
    }

    /**
     * Accepts an invitation to join a group
     * @param {string} inviteCode Invitation code
     * @returns {Promise<string>} Id of the joined Chat
     */
    async acceptInvite(inviteCode) {
        const res = await (async inviteCode => {
            return await window.Store.GroupInvite.joinGroupViaInvite(inviteCode);
        })(inviteCode);

        return res.gid._serialized;
    }

    /**
     * Accepts a channel admin invitation and promotes the current user to a channel admin
     * @param {string} channelId The channel ID to accept the admin invitation from
     * @returns {Promise<boolean>} Returns true if the operation completed successfully, false otherwise
     */
    async acceptChannelAdminInvite(channelId) {
        return await (async (channelId) => {
            try {
                await window.Store.ChannelUtils.acceptNewsletterAdminInvite(channelId);
                return true;
            } catch (err) {
                if (err.name === 'ServerStatusCodeError') return false;
                throw err;
            }
        })(channelId);
    }

    /**
     * Revokes a channel admin invitation sent to a user by a channel owner
     * @param {string} channelId The channel ID an invitation belongs to
     * @param {string} userId The user ID the invitation was sent to
     * @returns {Promise<boolean>} Returns true if the operation completed successfully, false otherwise
     */
    async revokeChannelAdminInvite(channelId, userId) {
        return await (async (channelId, userId) => {
            try {
                const userWid = window.Store.WidFactory.createWid(userId);
                await window.Store.ChannelUtils.revokeNewsletterAdminInvite(channelId, userWid);
                return true;
            } catch (err) {
                if (err.name === 'ServerStatusCodeError') return false;
                throw err;
            }
        })(channelId, userId);
    }

    /**
     * Demotes a channel admin to a regular subscriber (can be used also for self-demotion)
     * @param {string} channelId The channel ID to demote an admin in
     * @param {string} userId The user ID to demote
     * @returns {Promise<boolean>} Returns true if the operation completed successfully, false otherwise
     */
    async demoteChannelAdmin(channelId, userId) {
        return await (async (channelId, userId) => {
            try {
                const userWid = window.Store.WidFactory.createWid(userId);
                await window.Store.ChannelUtils.demoteNewsletterAdmin(channelId, userWid);
                return true;
            } catch (err) {
                if (err.name === 'ServerStatusCodeError') return false;
                throw err;
            }
        })(channelId, userId);
    }

    /**
     * Accepts a private invitation to join a group
     * @param {object} inviteInfo Invite V4 Info
     * @returns {Promise<Object>}
     */
    async acceptGroupV4Invite(inviteInfo) {
        if (!inviteInfo.inviteCode) throw 'Invalid invite code, try passing the message.inviteV4 object';
        if (inviteInfo.inviteCodeExp == 0) throw 'Expired invite code';
        return (async inviteInfo => {
            let { groupId, fromId, inviteCode, inviteCodeExp } = inviteInfo;
            let userWid = window.Store.WidFactory.createWid(fromId);
            return await window.Store.GroupInviteV4.joinGroupViaInviteV4(inviteCode, String(inviteCodeExp), groupId, userWid);
        })(inviteInfo);
    }

    /**
     * Sets the current user's status message
     * @param {string} status New status message
     */
    async setStatus(status) {
        await (async status => {
            return await window.Store.StatusUtils.setMyStatus(status);
        })(status);
    }

    /**
     * Sets the current user's display name.
     * This is the name shown to WhatsApp users that have not added you as a contact beside your number in groups and in your profile.
     * @param {string} displayName New display name
     * @returns {Promise<Boolean>}
     */
    async setDisplayName(displayName) {
        const couldSet = await (async displayName => {
            if (!window.Store.Conn.canSetMyPushname()) return false;
            await window.Store.Settings.setPushname(displayName);
            return true;
        })(displayName);

        return couldSet;
    }

    /**
     * Gets the current connection state for the client
     * @returns {WAState}
     */
    async getState() {
        return await (() => {
            if (!window.Store) return null;
            return window.Store.AppState.state;
        })();
    }

    /**
     * Marks the client as online
     */
    async sendPresenceAvailable() {
        return await (() => {
            return window.Store.PresenceUtils.sendPresenceAvailable();
        })();
    }

    /**
     * Marks the client as unavailable
     */
    async sendPresenceUnavailable() {
        return await (() => {
            return window.Store.PresenceUtils.sendPresenceUnavailable();
        })();
    }

    /**
     * Enables and returns the archive state of the Chat
     * @returns {boolean}
     */
    async archiveChat(chatId) {
        return await (async chatId => {
            let chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
            await window.Store.Cmd.archiveChat(chat, true);
            return true;
        })(chatId);
    }

    /**
     * Changes and returns the archive state of the Chat
     * @returns {boolean}
     */
    async unarchiveChat(chatId) {
        return await (async chatId => {
            let chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
            await window.Store.Cmd.archiveChat(chat, false);
            return false;
        })(chatId);
    }

    /**
     * Pins the Chat
     * @returns {Promise<boolean>} New pin state. Could be false if the max number of pinned chats was reached.
     */
    async pinChat(chatId) {
        return (async chatId => {
            let chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
            if (chat.pin) {
                return true;
            }
            const MAX_PIN_COUNT = 3;
            const chatModels = window.Store.Chat.getModelsArray();
            if (chatModels.length > MAX_PIN_COUNT) {
                let maxPinned = chatModels[MAX_PIN_COUNT - 1].pin;
                if (maxPinned) {
                    return false;
                }
            }
            await window.Store.Cmd.pinChat(chat, true);
            return true;
        })(chatId);
    }

    /**
     * Unpins the Chat
     * @returns {Promise<boolean>} New pin state
     */
    async unpinChat(chatId) {
        return (async chatId => {
            let chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
            if (!chat.pin) {
                return false;
            }
            await window.Store.Cmd.pinChat(chat, false);
            return false;
        })(chatId);
    }

    /**
     * Mutes this chat forever, unless a date is specified
     * @param {string} chatId ID of the chat that will be muted
     * @param {?Date} unmuteDate Date when the chat will be unmuted, don't provide a value to mute forever
     * @returns {Promise<{isMuted: boolean, muteExpiration: number}>}
     */
    async muteChat(chatId, unmuteDate) {
        unmuteDate = unmuteDate ? Math.floor(unmuteDate.getTime() / 1000) : -1;
        return this._muteUnmuteChat(chatId, 'MUTE', unmuteDate);
    }

    /**
     * Unmutes the Chat
     * @param {string} chatId ID of the chat that will be unmuted
     * @returns {Promise<{isMuted: boolean, muteExpiration: number}>}
     */
    async unmuteChat(chatId) {
        return this._muteUnmuteChat(chatId, 'UNMUTE');
    }

    /**
     * Internal method to mute or unmute the chat
     * @param {string} chatId ID of the chat that will be muted/unmuted
     * @param {string} action The action: 'MUTE' or 'UNMUTE'
     * @param {number} unmuteDateTs Timestamp at which the chat will be unmuted
     * @returns {Promise<{isMuted: boolean, muteExpiration: number}>}
     */
    async _muteUnmuteChat(chatId, action, unmuteDateTs) {
        return (async (chatId, action, unmuteDateTs) => {
            const chat = window.Store.Chat.get(chatId) ?? await window.Store.Chat.find(chatId);
            action === 'MUTE'
                ? await chat.mute.mute({ expiration: unmuteDateTs, sendDevice: true })
                : await chat.mute.unmute({ sendDevice: true });
            return { isMuted: chat.mute.expiration !== 0, muteExpiration: chat.mute.expiration };
        })(chatId, action, unmuteDateTs || -1);
    }

    /**
     * Mark the Chat as unread
     * @param {string} chatId ID of the chat that will be marked as unread
     */
    async markChatUnread(chatId) {
        await (async chatId => {
            let chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
            await window.Store.Cmd.markChatUnread(chat, true);
        })(chatId);
    }

    /**
     * Returns the contact ID's profile picture URL, if privacy settings allow it
     * @param {string} contactId the whatsapp user's ID
     * @returns {Promise<string>}
     */
    async getProfilePicUrl(contactId) {
        const profilePic = await (async contactId => {
            try {
                const chatWid = window.Store.WidFactory.createWid(contactId);
                return window.compareWwebVersions(window.Debug.VERSION, '<', '2.3000.0')
                    ? await window.Store.ProfilePic.profilePicFind(chatWid)
                    : await window.Store.ProfilePic.requestProfilePicFromServer(chatWid);
            } catch (err) {
                if (err.name === 'ServerStatusCodeError') return undefined;
                throw err;
            }
        })(contactId);

        return profilePic ? profilePic.eurl : undefined;
    }

    /**
     * Gets the Contact's common groups with you. Returns empty array if you don't have any common group.
     * @param {string} contactId the whatsapp user's ID (_serialized format)
     * @returns {Promise<WAWebJS.ChatId[]>}
     */
    async getCommonGroups(contactId) {
        const commonGroups = await (async (contactId) => {
            let contact = window.Store.Contact.get(contactId);
            if (!contact) {
                const wid = window.Store.WidFactory.createUserWid(contactId);
                const chatConstructor = window.Store.Contact.getModelsArray().find(c => !c.isGroup).constructor;
                contact = new chatConstructor({ id: wid });
            }

            if (contact.commonGroups) {
                return contact.commonGroups.serialize();
            }
            const status = await window.Store.findCommonGroups(contact);
            if (status) {
                return contact.commonGroups.serialize();
            }
            return [];
        })(contactId);
        const chats = [];
        for (const group of commonGroups) {
            chats.push(group.id);
        }
        return chats;
    }

    /**
     * Force reset of connection state for the client
    */
    async resetState() {
        await (() => {
            window.Store.AppState.reconnect();
        })();
    }

    /**
     * Check if a given ID is registered in whatsapp
     * @param {string} id the whatsapp user's ID
     * @returns {Promise<Boolean>}
     */
    async isRegisteredUser(id) {
        return Boolean(await this.getNumberId(id));
    }

    /**
     * Get the registered WhatsApp ID for a number.
     * Will return null if the number is not registered on WhatsApp.
     * @param {string} number Number or ID ("@c.us" will be automatically appended if not specified)
     * @returns {Promise<Object|null>}
     */
    async getNumberId(number) {
        if (!number.endsWith('@c.us')) {
            number += '@c.us';
        }

        return await (async number => {
            const wid = window.Store.WidFactory.createWid(number);
            const result = await window.Store.QueryExist(wid);
            if (!result || result.wid === undefined) return null;
            return result.wid;
        })(number);
    }

    /**
     * Get the formatted number of a WhatsApp ID.
     * @param {string} number Number or ID
     * @returns {Promise<string>}
     */
    async getFormattedNumber(number) {
        if (!number.endsWith('@s.whatsapp.net')) number = number.replace('c.us', 's.whatsapp.net');
        if (!number.includes('@s.whatsapp.net')) number = `${number}@s.whatsapp.net`;

        return await (async numberId => {
            return window.Store.NumberInfo.formattedPhoneNumber(numberId);
        })(number);
    }

    /**
     * Get the country code of a WhatsApp ID.
     * @param {string} number Number or ID
     * @returns {Promise<string>}
     */
    async getCountryCode(number) {
        number = number.replace(' ', '').replace('+', '').replace('@c.us', '');

        return await (async numberId => {
            return window.Store.NumberInfo.findCC(numberId);
        })(number);
    }

    /**
     * An object that represents the result for a participant added to a group
     * @typedef {Object} ParticipantResult
     * @property {number} statusCode The status code of the result
     * @property {string} message The result message
     * @property {boolean} isGroupCreator Indicates if the participant is a group creator
     * @property {boolean} isInviteV4Sent Indicates if the inviteV4 was sent to the participant
     */

    /**
     * An object that handles the result for {@link createGroup} method
     * @typedef {Object} CreateGroupResult
     * @property {string} title A group title
     * @property {Object} gid An object that handles the newly created group ID
     * @property {string} gid.server
     * @property {string} gid.user
     * @property {string} gid._serialized
     * @property {Object.<string, ParticipantResult>} participants An object that handles the result value for each added to the group participant
     */

    /**
     * An object that handles options for group creation
     * @typedef {Object} CreateGroupOptions
     * @property {number} [messageTimer = 0] The number of seconds for the messages to disappear in the group (0 by default, won't take an effect if the group is been creating with myself only)
     * @property {string|undefined} parentGroupId The ID of a parent community group to link the newly created group with (won't take an effect if the group is been creating with myself only)
     * @property {boolean} [autoSendInviteV4 = true] If true, the inviteV4 will be sent to those participants who have restricted others from being automatically added to groups, otherwise the inviteV4 won't be sent (true by default)
     * @property {string} [comment = ''] The comment to be added to an inviteV4 (empty string by default)
     */

    /**
     * Creates a new group
     * @param {string} title Group title
     * @param {string|Contact|Array<Contact|string>|undefined} participants A single Contact object or an ID as a string or an array of Contact objects or contact IDs to add to the group
     * @param {CreateGroupOptions} options An object that handles options for group creation
     * @returns {Promise<CreateGroupResult|string>} Object with resulting data or an error message as a string
     */
    async createGroup(title, participants = [], options = {}) {
        !Array.isArray(participants) && (participants = [participants]);
        participants.map(p => (p instanceof Contact) ? p.id._serialized : p);

        return await (async (title, participants, options) => {
            const { messageTimer = 0, parentGroupId, autoSendInviteV4 = true, comment = '' } = options;
            const participantData = {}, participantWids = [], failedParticipants = [];
            let createGroupResult, parentGroupWid;

            const addParticipantResultCodes = {
                default: 'An unknown error occupied while adding a participant',
                200: 'The participant was added successfully',
                403: 'The participant can be added by sending private invitation only',
                404: 'The phone number is not registered on WhatsApp'
            };

            for (const participant of participants) {
                const pWid = window.Store.WidFactory.createWid(participant);
                if ((await window.Store.QueryExist(pWid))?.wid) participantWids.push(pWid);
                else failedParticipants.push(participant);
            }

            parentGroupId && (parentGroupWid = window.Store.WidFactory.createWid(parentGroupId));

            try {
                createGroupResult = await window.Store.GroupUtils.createGroup(
                    {
                        'memberAddMode': options.memberAddMode === undefined ? true : options.memberAddMode,
                        'membershipApprovalMode': options.membershipApprovalMode === undefined ? false : options.membershipApprovalMode,
                        'announce': options.announce === undefined ? true : options.announce,
                        'ephemeralDuration': messageTimer,
                        'full': undefined,
                        'parentGroupId': parentGroupWid,
                        'restrict': options.restrict === undefined ? true : options.restrict,
                        'thumb': undefined,
                        'title': title,
                    },
                    participantWids
                );
            } catch (err) {
                return 'CreateGroupError: An unknown error occupied while creating a group';
            }

            for (const participant of createGroupResult.participants) {
                let isInviteV4Sent = false;
                const participantId = participant.wid._serialized;
                const statusCode = participant.error || 200;

                if (autoSendInviteV4 && statusCode === 403) {
                    window.Store.Contact.gadd(participant.wid, { silent: true });
                    const addParticipantResult = await window.Store.GroupInviteV4.sendGroupInviteMessage(
                        await window.Store.Chat.find(participant.wid),
                        createGroupResult.wid._serialized,
                        createGroupResult.subject,
                        participant.invite_code,
                        participant.invite_code_exp,
                        comment,
                        await window.WWebJS.getProfilePicThumbToBase64(createGroupResult.wid)
                    );
                    isInviteV4Sent = window.compareWwebVersions(window.Debug.VERSION, '<', '2.2335.6')
                        ? addParticipantResult === 'OK'
                        : addParticipantResult.messageSendResult === 'OK';
                }

                participantData[participantId] = {
                    statusCode: statusCode,
                    message: addParticipantResultCodes[statusCode] || addParticipantResultCodes.default,
                    isGroupCreator: participant.type === 'superadmin',
                    isInviteV4Sent: isInviteV4Sent
                };
            }

            for (const f of failedParticipants) {
                participantData[f] = {
                    statusCode: 404,
                    message: addParticipantResultCodes[404],
                    isGroupCreator: false,
                    isInviteV4Sent: false
                };
            }

            return { title: title, gid: createGroupResult.wid, participants: participantData };
        })(title, participants, options);
    }

    /**
     * An object that handles the result for {@link createChannel} method
     * @typedef {Object} CreateChannelResult
     * @property {string} title A channel title
     * @property {ChatId} nid An object that handels the newly created channel ID
     * @property {string} nid.server 'newsletter'
     * @property {string} nid.user 'XXXXXXXXXX'
     * @property {string} nid._serialized 'XXXXXXXXXX@newsletter'
     * @property {string} inviteLink The channel invite link, starts with 'https://whatsapp.com/channel/'
     * @property {number} createdAtTs The timestamp the channel was created at
     */

    /**
     * Options for the channel creation
     * @typedef {Object} CreateChannelOptions
     * @property {?string} description The channel description
     * @property {?MessageMedia} picture The channel profile picture
     */

    /**
     * Creates a new channel
     * @param {string} title The channel name
     * @param {CreateChannelOptions} options
     * @returns {Promise<CreateChannelResult|string>} Returns an object that handles the result for the channel creation or an error message as a string
     */
    async createChannel(title, options = {}) {
        return await (async (title, options) => {
            let response, { description = null, picture = null } = options;

            if (!window.Store.ChannelUtils.isNewsletterCreationEnabled()) {
                return 'CreateChannelError: A channel creation is not enabled';
            }

            if (picture) {
                picture = await window.WWebJS.cropAndResizeImage(picture, {
                    asDataUrl: true,
                    mimetype: 'image/jpeg',
                    size: 640,
                    quality: 1
                });
            }

            try {
                response = await window.Store.ChannelUtils.createNewsletterQuery({
                    name: title,
                    description: description,
                    picture: picture,
                });
            } catch (err) {
                if (err.name === 'ServerStatusCodeError') {
                    return 'CreateChannelError: An error occupied while creating a channel';
                }
                throw err;
            }

            return {
                title: title,
                nid: window.Store.JidToWid.newsletterJidToWid(response.idJid),
                inviteLink: `https://whatsapp.com/channel/${response.newsletterInviteLinkMetadataMixin.inviteCode}`,
                createdAtTs: response.newsletterCreationTimeMetadataMixin.creationTimeValue
            };
        })(title, options);
    }

    /**
     * Subscribe to channel
     * @param {string} channelId The channel ID
     * @returns {Promise<boolean>} Returns true if the operation completed successfully, false otherwise
     */
    async subscribeToChannel(channelId) {
        return await (async (channelId) => {
            return await window.WWebJS.subscribeToUnsubscribeFromChannel(channelId, 'Subscribe');
        })(channelId);
    }

    /**
     * Options for unsubscribe from a channel
     * @typedef {Object} UnsubscribeOptions
     * @property {boolean} [deleteLocalModels = false] If true, after an unsubscription, it will completely remove a channel from the channel collection making it seem like the current user have never interacted with it. Otherwise it will only remove a channel from the list of channels the current user is subscribed to and will set the membership type for that channel to GUEST
     */

    /**
     * Unsubscribe from channel
     * @param {string} channelId The channel ID
     * @param {UnsubscribeOptions} options
     * @returns {Promise<boolean>} Returns true if the operation completed successfully, false otherwise
     */
    async unsubscribeFromChannel(channelId, options) {
        return await (async (channelId, options) => {
            return await window.WWebJS.subscribeToUnsubscribeFromChannel(channelId, 'Unsubscribe', options);
        })(channelId, options);
    }

    /**
     * Options for transferring a channel ownership to another user
     * @typedef {Object} TransferChannelOwnershipOptions
     * @property {boolean} [shouldDismissSelfAsAdmin = false] If true, after the channel ownership is being transferred to another user, the current user will be dismissed as a channel admin and will become to a channel subscriber.
     */

    /**
     * Transfers a channel ownership to another user.
     * Note: the user you are transferring the channel ownership to must be a channel admin.
     * @param {string} channelId
     * @param {string} newOwnerId
     * @param {TransferChannelOwnershipOptions} options
     * @returns {Promise<boolean>} Returns true if the operation completed successfully, false otherwise
     */
    async transferChannelOwnership(channelId, newOwnerId, options = {}) {
        return await (async (channelId, newOwnerId, options) => {
            const channel = await window.WWebJS.getChat(channelId, { getAsModel: false });
            const newOwner = window.Store.Contact.get(newOwnerId) || (await window.Store.Contact.find(newOwnerId));
            if (!channel.newsletterMetadata) {
                await window.Store.NewsletterMetadataCollection.update(channel.id);
            }

            try {
                await window.Store.ChannelUtils.changeNewsletterOwnerAction(channel, newOwner);

                if (options.shouldDismissSelfAsAdmin) {
                    const meContact = window.Store.ContactCollection.getMeContact();
                    meContact && (await window.Store.ChannelUtils.demoteNewsletterAdminAction(channel, meContact));
                }
            } catch (error) {
                return false;
            }

            return true;
        })(channelId, newOwnerId, options);
    }

    /**
     * Searches for channels based on search criteria, there are some notes:
     * 1. The method finds only channels you are not subscribed to currently
     * 2. If you have never been subscribed to a found channel
     * or you have unsubscribed from it with {@link UnsubscribeOptions.deleteLocalModels} set to 'true',
     * the lastMessage property of a found channel will be 'null'
     *
     * @param {Object} searchOptions Search options
     * @param {string} [searchOptions.searchText = ''] Text to search
     * @param {Array<string>} [searchOptions.countryCodes = [your local region]] Array of country codes in 'ISO 3166-1 alpha-2' standart (@see https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2) to search for channels created in these countries
     * @param {boolean} [searchOptions.skipSubscribedNewsletters = false] If true, channels that user is subscribed to won't appear in found channels
     * @param {number} [searchOptions.view = 0] View type, makes sense only when the searchText is empty. Valid values to provide are:
     * 0 for RECOMMENDED channels
     * 1 for TRENDING channels
     * 2 for POPULAR channels
     * 3 for NEW channels
     * @param {number} [searchOptions.limit = 50] The limit of found channels to be appear in the returnig result
     * @returns {Promise<Array<Channel>|[]>} Returns an array of Channel objects or an empty array if no channels were found
     */
    async searchChannels(searchOptions = {}) {
        return await (async ({
            searchText = '',
            countryCodes = [window.Store.ChannelUtils.currentRegion],
            skipSubscribedNewsletters = false,
            view = 0,
            limit = 50
        }) => {
            searchText = searchText.trim();
            const currentRegion = window.Store.ChannelUtils.currentRegion;
            if (![0, 1, 2, 3].includes(view)) view = 0;

            countryCodes = countryCodes.length === 1 && countryCodes[0] === currentRegion
                ? countryCodes
                : countryCodes.filter((code) => Object.keys(window.Store.ChannelUtils.countryCodesIso).includes(code));

            const viewTypeMapping = {
                0: 'RECOMMENDED',
                1: 'TRENDING',
                2: 'POPULAR',
                3: 'NEW'
            };

            searchOptions = {
                searchText: searchText,
                countryCodes: countryCodes,
                skipSubscribedNewsletters: skipSubscribedNewsletters,
                view: viewTypeMapping[view],
                categories: [],
                cursorToken: ''
            };

            const originalFunction = window.Store.ChannelUtils.getNewsletterDirectoryPageSize;
            limit !== 50 && (window.Store.ChannelUtils.getNewsletterDirectoryPageSize = () => limit);

            const channels = (await window.Store.ChannelUtils.fetchNewsletterDirectories(searchOptions)).newsletters;

            limit !== 50 && (window.Store.ChannelUtils.getNewsletterDirectoryPageSize = originalFunction);

            return channels
                ? await Promise.all(channels.map((channel) => window.WWebJS.getChatModel(channel, { isChannel: true })))
                : [];
        })(searchOptions);
    }


    /**
     * Get all current Labels
     * @returns {Promise<Array<Label>>}
     */
    async getLabels() {
        return window.WWebJS.getLabels();
    }

    /**
     * Get all current Broadcast
     * @returns {Promise<Array<Broadcast>>}
     */
    async getBroadcasts() {
        const broadcasts = await (async () => {
            return window.WWebJS.getAllStatuses();
        })();
        return broadcasts.map(data => new Broadcast(this, data));
    }

    /**
     * Get Label instance by ID
     * @param {string} labelId
     * @returns {Promise<Label>}
     */
    async getLabelById(labelId) {
        const label = await (async (labelId) => {
            return window.WWebJS.getLabel(labelId);
        })(labelId);

        return new Label(this, label);
    }

    /**
     * Get all Labels assigned to a chat
     * @param {string} chatId
     * @returns {Promise<Array<Label>>}
     */
    async getChatLabels(chatId) {
        const labels = await (async (chatId) => {
            return window.WWebJS.getChatLabels(chatId);
        })(chatId);

        return labels.map(data => new Label(this, data));
    }

    /**
     * Get all Chats for a specific Label
     * @param {string} labelId
     * @returns {Promise<Array<Chat>>}
     */
    async getChatsByLabelId(labelId) {
        const chatIds = await (async (labelId) => {
            const label = window.Store.Label.get(labelId);
            const labelItems = label.labelItemCollection.getModelsArray();
            return labelItems.reduce((result, item) => {
                if (item.parentType === 'Chat') {
                    result.push(item.parentId);
                }
                return result;
            }, []);
        })(labelId);

        return Promise.all(chatIds.map(id => this.getChatById(id)));
    }

    /**
     * Gets all blocked contacts by host account
     * @returns {Promise<Array<Contact>>}
     */
    async getBlockedContacts() {
        const blockedContacts = await (() => {
            let chatIds = window.Store.Blocklist.getModelsArray().map(a => a.id._serialized);
            return Promise.all(chatIds.map(id => window.WWebJS.getContact(id)));
        })();

        return blockedContacts.map(contact => ContactFactory.create(this.client, contact));
    }

    /**
     * Sets the current user's profile picture.
     * @param {MessageMedia} media
     * @returns {Promise<boolean>} Returns true if the picture was properly updated.
     */
    async setProfilePicture(media) {
        const success = await ((chatid, media) => {
            return window.WWebJS.setPicture(chatid, media);
        })(this.info.wid._serialized, media);

        return success;
    }

    /**
     * Deletes the current user's profile picture.
     * @returns {Promise<boolean>} Returns true if the picture was properly deleted.
     */
    async deleteProfilePicture() {
        const success = await ((chatid) => {
            return window.WWebJS.deletePicture(chatid);
        })(this.info.wid._serialized);

        return success;
    }

    /**
     * Change labels in chats
     * @param {Array<number|string>} labelIds
     * @param {Array<string>} chatIds
     * @returns {Promise<void>}
     */
    async addOrRemoveLabels(labelIds, chatIds) {

        return (async (labelIds, chatIds) => {
            if (['smba', 'smbi'].indexOf(window.Store.Conn.platform) === -1) {
                throw '[LT01] Only Whatsapp business';
            }
            const labels = window.WWebJS.getLabels().filter(e => labelIds.find(l => l == e.id) !== undefined);
            const chats = window.Store.Chat.filter(e => chatIds.includes(e.id._serialized));

            let actions = labels.map(label => ({ id: label.id, type: 'add' }));

            chats.forEach(chat => {
                (chat.labels || []).forEach(n => {
                    if (!actions.find(e => e.id == n)) {
                        actions.push({ id: n, type: 'remove' });
                    }
                });
            });

            return await window.Store.Label.addOrRemoveLabels(actions, chats);
        })(labelIds, chatIds);
    }

    /**
     * An object that handles the information about the group membership request
     * @typedef {Object} GroupMembershipRequest
     * @property {Object} id The wid of a user who requests to enter the group
     * @property {Object} addedBy The wid of a user who created that request
     * @property {Object|null} parentGroupId The wid of a community parent group to which the current group is linked
     * @property {string} requestMethod The method used to create the request: NonAdminAdd/InviteLink/LinkedGroupJoin
     * @property {number} t The timestamp the request was created at
     */

    /**
     * Gets an array of membership requests
     * @param {string} groupId The ID of a group to get membership requests for
     * @returns {Promise<Array<GroupMembershipRequest>>} An array of membership requests
     */
    async getGroupMembershipRequests(groupId) {
        return await (async (groupId) => {
            const groupWid = window.Store.WidFactory.createWid(groupId);
            return await window.Store.MembershipRequestUtils.getMembershipApprovalRequests(groupWid);
        })(groupId);
    }

    /**
     * An object that handles the result for membership request action
     * @typedef {Object} MembershipRequestActionResult
     * @property {string} requesterId User ID whos membership request was approved/rejected
     * @property {number|undefined} error An error code that occurred during the operation for the participant
     * @property {string} message A message with a result of membership request action
     */

    /**
     * An object that handles options for {@link approveGroupMembershipRequests} and {@link rejectGroupMembershipRequests} methods
     * @typedef {Object} MembershipRequestActionOptions
     * @property {Array<string>|string|null} requesterIds User ID/s who requested to join the group, if no value is provided, the method will search for all membership requests for that group
     * @property {Array<number>|number|null} sleep The number of milliseconds to wait before performing an operation for the next requester. If it is an array, a random sleep time between the sleep[0] and sleep[1] values will be added (the difference must be >=100 ms, otherwise, a random sleep time between sleep[1] and sleep[1] + 100 will be added). If sleep is a number, a sleep time equal to its value will be added. By default, sleep is an array with a value of [250, 500]
     */

    /**
     * Approves membership requests if any
     * @param {string} groupId The group ID to get the membership request for
     * @param {MembershipRequestActionOptions} options Options for performing a membership request action
     * @returns {Promise<Array<MembershipRequestActionResult>>} Returns an array of requester IDs whose membership requests were approved and an error for each requester, if any occurred during the operation. If there are no requests, an empty array will be returned
     */
    async approveGroupMembershipRequests(groupId, options = {}) {
        return await (async (groupId, options) => {
            const { requesterIds = null, sleep = [250, 500] } = options;
            return await window.WWebJS.membershipRequestAction(groupId, 'Approve', requesterIds, sleep);
        })(groupId, options);
    }

    /**
     * Rejects membership requests if any
     * @param {string} groupId The group ID to get the membership request for
     * @param {MembershipRequestActionOptions} options Options for performing a membership request action
     * @returns {Promise<Array<MembershipRequestActionResult>>} Returns an array of requester IDs whose membership requests were rejected and an error for each requester, if any occurred during the operation. If there are no requests, an empty array will be returned
     */
    async rejectGroupMembershipRequests(groupId, options = {}) {
        return await (async (groupId, options) => {
            const { requesterIds = null, sleep = [250, 500] } = options;
            return await window.WWebJS.membershipRequestAction(groupId, 'Reject', requesterIds, sleep);
        })(groupId, options);
    }


    /**
     * Setting  autoload download audio
     * @param {boolean} flag true/false
     */
    async setAutoDownloadAudio(flag) {
        await (async flag => {
            const autoDownload = window.Store.Settings.getAutoDownloadAudio();
            if (autoDownload === flag) {
                return flag;
            }
            await window.Store.Settings.setAutoDownloadAudio(flag);
            return flag;
        })(flag);
    }

    /**
     * Setting  autoload download documents
     * @param {boolean} flag true/false
     */
    async setAutoDownloadDocuments(flag) {
        await (async flag => {
            const autoDownload = window.Store.Settings.getAutoDownloadDocuments();
            if (autoDownload === flag) {
                return flag;
            }
            await window.Store.Settings.setAutoDownloadDocuments(flag);
            return flag;
        })(flag);
    }

    /**
     * Setting  autoload download photos
     * @param {boolean} flag true/false
     */
    async setAutoDownloadPhotos(flag) {
        await (async flag => {
            const autoDownload = window.Store.Settings.getAutoDownloadPhotos();
            if (autoDownload === flag) {
                return flag;
            }
            await window.Store.Settings.setAutoDownloadPhotos(flag);
            return flag;
        })(flag);
    }

    /**
     * Setting  autoload download videos
     * @param {boolean} flag true/false
     */
    async setAutoDownloadVideos(flag) {
        await (async flag => {
            const autoDownload = window.Store.Settings.getAutoDownloadVideos();
            if (autoDownload === flag) {
                return flag;
            }
            await window.Store.Settings.setAutoDownloadVideos(flag);
            return flag;
        })(flag);
    }

    /**
     * Setting background synchronization.
     * NOTE: this action will take effect after you restart the client.
     * @param {boolean} flag true/false
     * @returns {Promise<boolean>}
     */
    async setBackgroundSync(flag) {
        return await (async flag => {
            const backSync = window.Store.Settings.getGlobalOfflineNotifications();
            if (backSync === flag) {
                return flag;
            }
            await window.Store.Settings.setGlobalOfflineNotifications(flag);
            return flag;
        })(flag);
    }

    /**
     * Get user device count by ID
     * Each WaWeb Connection counts as one device, and the phone (if exists) counts as one
     * So for a non-enterprise user with one WaWeb connection it should return "2"
     * @param {string} userId
     * @returns {Promise<number>}
     */
    async getContactDeviceCount(userId) {
        return await (async (userId) => {
            const devices = await window.Store.DeviceList.getDeviceIds([window.Store.WidFactory.createWid(userId)]);
            if (devices && devices.length && devices[0] != null && typeof devices[0].devices == 'object') {
                return devices[0].devices.length;
            }
            return 0;
        })(userId);
    }

    /**
     * Sync chat history conversation
     * @param {string} chatId
     * @return {Promise<boolean>} True if operation completed successfully, false otherwise.
     */
    async syncHistory(chatId) {
        return await (async (chatId) => {
            const chatWid = window.Store.WidFactory.createWid(chatId);
            const chat = window.Store.Chat.get(chatWid) ?? (await window.Store.Chat.find(chatWid));
            if (chat?.endOfHistoryTransferType === 0) {
                await window.Store.HistorySync.sendPeerDataOperationRequest(3, {
                    chatId: chat.id
                });
                return true;
            }
            return false;
        })(chatId);
    }

    /**
     * Save new contact to user's addressbook or edit the existing one
     * @param {string} phoneNumber The contact's phone number in a format "17182222222", where "1" is a country code
     * @param {string} firstName
     * @param {string} lastName
     * @param {boolean} [syncToAddressbook = false] If set to true, the contact will also be saved to the user's address book on their phone. False by default
     * @returns {Promise<import('..').ChatId>} Object in a wid format
     */
    async saveOrEditAddressbookContact(phoneNumber, firstName, lastName, syncToAddressbook = false) {
        return await (async (phoneNumber, firstName, lastName, syncToAddressbook) => {
            return await window.Store.AddressbookContactUtils.saveContactAction(
                phoneNumber,
                null,
                firstName,
                lastName,
                syncToAddressbook
            );
        })(phoneNumber, firstName, lastName, syncToAddressbook);
    }

    /**
     * Deletes the contact from user's addressbook
     * @param {string} phoneNumber The contact's phone number in a format "17182222222", where "1" is a country code
     * @returns {Promise<void>}
     */
    async deleteAddressbookContact(phoneNumber) {
        return await (async (phoneNumber) => {
            return await window.Store.AddressbookContactUtils.deleteContactAction(phoneNumber);
        })(phoneNumber);
    }
}

(async () => {
    console.log("Initializing WhatsApp client...");
    const client = new Client();
    await client.attachEventListeners();
    window.whatsapp_client = client;
    console.log("WhatsApp client initialized and attached to window.whatsapp_client");
})();