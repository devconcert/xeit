var xeit = (function () {
	"use strict";

	/**********
	 * Vendor *
	 **********/

	var Vendor = function (name) {
		this.name = name || '';
	};

	Vendor.prototype = {
		encode: function (content) {
			var message = CryptoJS.enc.Latin1.stringify(content);
			if (message.match(/utf-8/i)) {
				message = CryptoJS.enc.Utf8.stringify(content);
			} else {
				message = CryptoJS.enc.CP949.stringify(content);
	        	message = message.replace(/euc-kr/ig, 'utf-8');
			}

			//HACK: DOCTYPE 없는 메일도 있으니 헤더와 본문 사이의 줄바꿈으로 인식.
			// message = message.replace(/[\s\S]*(<!DOCTYPE)/i, "$1")
			var offset = /[\n\r]{3,}/.exec(message);
			if (offset) {
				message = message.slice(offset.index);
			}
			return message;
		}
	};

	/***************************
	 * SoftForum XecureExpress *
	 ***************************/

	var SoftForum = function (smime_header, smime_body, ui_desc) {
		this.smime_header = smime_header || '';
		this.smime_body = smime_body || '';
		this.ui_desc = ui_desc || '';
	};

	SoftForum.prototype = new Vendor('SoftForum');
	$.extend(SoftForum.prototype, {
		decrypt: function (password) {
			var headerWords = CryptoJS.enc.Base64.parse(this.smime_header);
			var header = CryptoJS.enc.CP949.stringify(headerWords);

			var contentType = header.match(/Content-Type: \s*([\w-\/]+);*/i)[1];
			if (contentType == 'application/pkcs7-mime') {
				var content = this.decryptSMIME(this.smime_body, password);
			} else if (contentType == 'application/x-pwd') {
				var key = header.match(/X-XE_KEY: \s*([\d]+): \s*([\w+\/=]+);*/i)[2];
				var content = this.decryptPWD(key, this.smime_body, password);
			}

			// 메일 본문 인코딩 변환.
			return this.encode(content);
		},

		decryptSMIME: function (envelope, password) {
			var ciphers = {
				desCBC: CryptoJS.DES,	// 1.3.14.3.2.7,
				seedCBC: CryptoJS.SEED	// 1.2.410.200004.1.4
			};

			ASN1.prototype.contentRaw = function () {
				var offset = this.posContent();
				var length = this.length;
				return this.stream.parseStringISO(offset, offset + length);
			};

			var der = Base64.unarmor(envelope);
			var asn1 = ASN1.decode(der);
			var envelopedData = asn1.sub[1].sub[0];

			// 주민등록번호로 암호화된 대칭키 복호화.
			var recipientInfos = envelopedData.sub[1];
			var keyTransportRecipientInfo = recipientInfos.sub[0];
			var keyEncryptionAlgorithm = oids[keyTransportRecipientInfo.sub[2].sub[0].content()].d;
			var encryptedKey = CryptoJS.enc.Latin1.parse(keyTransportRecipientInfo.sub[3].contentRaw());
			var passwordKey = CryptoJS.SHA1(password);
			var iv = CryptoJS.enc.Hex.parse("0");
			var decryptedKey = ciphers[keyEncryptionAlgorithm].decrypt(
				{ ciphertext: encryptedKey },
				passwordKey,
				{ iv: iv }
			);

			// 대칭키로 암호화된 메일 본문 복호화.
			var encryptedContentInfo = envelopedData.sub[2];
			var contentEncryptionAlgorithm = oids[encryptedContentInfo.sub[1].sub[0].content()].d;
			var encryptedContent = CryptoJS.enc.Latin1.parse(encryptedContentInfo.sub[2].contentRaw());
			var decryptedContent = ciphers[contentEncryptionAlgorithm].decrypt(
				{ ciphertext: encryptedContent },
				decryptedKey,
				{ iv: iv }
			);
			return decryptedContent;
		},

		decryptPWD: function (key, content, password) {
			var encryptedKey = CryptoJS.enc.Base64.parse(key);
			var passwordKey = CryptoJS.SHA1(password);
			var iv = CryptoJS.enc.Hex.parse("0");
			var decryptedKey = CryptoJS.SEED.decrypt(
				{ ciphertext: encryptedKey },
				passwordKey,
				{ iv: iv }
			);

			var encryptedContent = CryptoJS.enc.Base64.parse(content);
			var decryptedContent = CryptoJS.SEED.decrypt(
				{ ciphertext: encryptedContent },
				decryptedKey,
				{ iv: iv }
			);
			return decryptedContent;
		}
	});

	/************************
	 * IniTech INISAFE Mail *
	 ************************/

	var IniTech = function (contents, attachedFile) {
		this.contents = contents || '';
		this.attachedFile = attachedFile || '';
	};

	IniTech.prototype = new Vendor('it');
	$.extend(IniTech.prototype, {
		decrypt: function (password) {
			alert('TODO: support IT');
		}
	});

	return {
		init: function (doc) {
			if ($('#XEIViewer', doc).length) {
				this.vendor = new SoftForum(
					$('param[name="smime_header"]', doc).val().replace(/\n/g, ''),
					$('param[name="smime_body"]', doc).val().replace(/\n/g, ''),
					$('param[name="ui_desc"]', doc).val()
				);
			} else if ($('#IniMasPluginObj', doc).length) {
				//TODO: use '#InitechSMMsgToReplace'?
				this.vendor = new IniTech(
					$('param[name="IniSMContents"]', doc).val(),
					$('param[name="AttachedFile"]', doc).val()
				);
			} else {
				this.vendor = new Vendor();
				parent.postMessage('fallback', '*');
			}

			//TODO: updateBlob(blob)
		},

		updateAuthDialog: function () {
			var senders = {
				TRUEFRIEND: { name: '한국투자증권', support: true },
				'보안메일': { name: 'KB카드', support: true },
				'HyundaiCard': { name: '현대카드', support: true }
			};
			var sender = senders[this.vendor.ui_desc];
			var name = sender ? sender['name'] : '?';
			var support = sender ? sender['support'] : false;

			$('#auth-sender-name').val(name);
			if (support) {
				$('#auth-sender-support').addClass('label-success').text('지원');
			} else {
				$('#auth-sender-support').addClass('label-important').text('미지원');
				$('#auth-password').prop('disabled', true);
				$('#auth-submit').addClass('disabled');
			}
		},

		decrypt: function (password) {
			return this.vendor.decrypt(password);
		}
	};
})();
