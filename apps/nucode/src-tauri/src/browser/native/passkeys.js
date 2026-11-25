(() => {
  try {
    // Everything the shim relies on is captured now, before any page script can replace it.
    const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nucodePasskey;
    const container = window.CredentialsContainer && window.CredentialsContainer.prototype;
    if (!handler || !container || !navigator.credentials) return;
    const post = Function.prototype.call.bind(handler.postMessage, handler);
    const origCreate = container.create, origGet = container.get;
    const { defineProperty, defineProperties, create: objectCreate, keys: objectKeys } = Object;
    const apply = Reflect.apply;
    const P = Promise, thenOf = Function.prototype.call.bind(P.prototype.then);
    const U8 = Uint8Array, AB = ArrayBuffer, isView = ArrayBuffer.isView;
    const stringify = JSON.stringify, parse = JSON.parse, fromCharCode = String.fromCharCode;
    const btoa_ = btoa, atob_ = atob, isArray = Array.isArray;
    const DOMEx = DOMException, TypeErr = TypeError;
    const callReplace = Function.prototype.call.bind(String.prototype.replace);
    let seq = 0;

    const enc = (value) => {
      const bytes = isView(value) ? new U8(value.buffer, value.byteOffset, value.byteLength) : new U8(value);
      let text = "";
      for (let i = 0; i < bytes.length; i++) text += fromCharCode(bytes[i]);
      return callReplace(callReplace(callReplace(btoa_(text), /\+/g, "-"), /\//g, "_"), /=+$/, "");
    };
    const dec = (text) => {
      const raw = atob_(callReplace(callReplace(text, /-/g, "+"), /_/g, "/"));
      const bytes = new U8(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return bytes.buffer;
    };
    const bin = (value, what) => {
      if (value instanceof AB || isView(value)) return enc(value);
      throw new TypeErr("The " + what + " is not a BufferSource");
    };
    const descriptors = (list, what) => {
      if (list === undefined || list === null) return [];
      const out = [];
      for (let i = 0; i < list.length; i++) out.push({ type: String(list[i].type), id: bin(list[i].id, what) });
      return out;
    };
    const dom = (name, message) => new DOMEx(message, name);
    const reasonOf = (signal) => (signal.reason !== undefined ? signal.reason : dom("AbortError", "The operation was aborted."));

    const toCreateOptions = (options, pk) => {
      const params = [];
      if (pk.pubKeyCredParams) for (let i = 0; i < pk.pubKeyCredParams.length; i++) params.push({ type: String(pk.pubKeyCredParams[i].type), alg: Number(pk.pubKeyCredParams[i].alg) });
      const rp = pk.rp || {}, user = pk.user || {}, selection = pk.authenticatorSelection || {};
      if (!pk.user) throw new TypeErr("The user member is required");
      return {
        challenge: bin(pk.challenge, "challenge"), rpId: rp.id === undefined ? undefined : String(rp.id), rpName: rp.name === undefined ? undefined : String(rp.name),
        user: { id: bin(user.id, "user id"), name: String(user.name), displayName: user.displayName === undefined ? undefined : String(user.displayName) },
        pubKeyCredParams: params, timeout: pk.timeout, userVerification: selection.userVerification, residentKey: selection.residentKey,
        attestation: "none", excludeCredentials: descriptors(pk.excludeCredentials, "excluded credential id"), mediation: options.mediation,
      };
    };
    const toGetOptions = (options, pk) => ({
      challenge: bin(pk.challenge, "challenge"), rpId: pk.rpId === undefined ? undefined : String(pk.rpId), timeout: pk.timeout,
      userVerification: pk.userVerification, allowCredentials: descriptors(pk.allowCredentials, "allowed credential id"), mediation: options.mediation,
    });

    // Real PublicKeyCredential objects cannot be built from script, so these borrow the prototypes.
    const ensure = (name, parent) => {
      if (typeof window[name] === "function") return window[name];
      const ctor = function () { throw new TypeErr("Illegal constructor"); };
      defineProperty(ctor, "name", { value: name });
      if (parent) ctor.prototype = objectCreate(parent.prototype, { constructor: { value: ctor, writable: true, configurable: true } });
      defineProperty(window, name, { value: ctor, writable: true, configurable: true });
      return ctor;
    };
    const Credential_ = typeof window.Credential === "function" ? window.Credential : undefined;
    const PKC = ensure("PublicKeyCredential", Credential_);
    const Response_ = ensure("AuthenticatorResponse");
    const AttestationResponse = ensure("AuthenticatorAttestationResponse", Response_);
    const AssertionResponse = ensure("AuthenticatorAssertionResponse", Response_);
    const readonly = (target, fields) => {
      const props = {};
      for (const key of objectKeys(fields)) props[key] = { value: fields[key], enumerable: true, configurable: true };
      defineProperties(target, props);
      return target;
    };
    const hidden = (target, name, value) => defineProperty(target, name, { value, writable: true, configurable: true });

    const buildCredential = (kind, r) => {
      const response = objectCreate((kind === "create" ? AttestationResponse : AssertionResponse).prototype);
      const bufs = {};
      for (const key of ["clientDataJSON", "attestationObject", "authenticatorData", "signature", "userHandle", "publicKey"]) if (r[key] !== undefined) bufs[key] = dec(r[key]);
      const json = { clientDataJSON: r.clientDataJSON, authenticatorData: r.authenticatorData };
      if (kind === "create") {
        readonly(response, { clientDataJSON: bufs.clientDataJSON, attestationObject: bufs.attestationObject });
        hidden(response, "getTransports", function getTransports() { return ["internal"]; });
        hidden(response, "getAuthenticatorData", function getAuthenticatorData() { return dec(r.authenticatorData); });
        hidden(response, "getPublicKey", function getPublicKey() { return dec(r.publicKey); });
        hidden(response, "getPublicKeyAlgorithm", function getPublicKeyAlgorithm() { return -7; });
        json.transports = ["internal"]; json.publicKey = r.publicKey; json.publicKeyAlgorithm = -7; json.attestationObject = r.attestationObject;
      } else {
        readonly(response, { clientDataJSON: bufs.clientDataJSON, authenticatorData: bufs.authenticatorData, signature: bufs.signature, userHandle: bufs.userHandle });
        json.signature = r.signature; json.userHandle = r.userHandle;
      }
      const credential = objectCreate(PKC.prototype);
      readonly(credential, { id: r.id, rawId: dec(r.rawId), type: "public-key", authenticatorAttachment: "platform", response });
      hidden(credential, "getClientExtensionResults", function getClientExtensionResults() { return {}; });
      hidden(credential, "toJSON", function toJSON() {
        return { id: r.id, rawId: r.rawId, type: "public-key", authenticatorAttachment: "platform", response: json, clientExtensionResults: {} };
      });
      return credential;
    };

    const ceremony = (kind, options, pk, build) => new P((resolve, reject) => {
      const signal = options.signal;
      if (signal && signal.aborted) { reject(reasonOf(signal)); return; }
      const id = ++seq;
      let done = false;
      const finish = (settle, value) => {
        if (done) return;
        done = true;
        if (signal) signal.removeEventListener("abort", onAbort);
        settle(value);
      };
      const onAbort = () => {
        finish(reject, reasonOf(signal));
        try { thenOf(post(stringify({ op: "cancel", id })), undefined, () => {}); } catch (e) { /* nothing to cancel */ }
      };
      if (signal) signal.addEventListener("abort", onAbort);
      let request;
      try { request = post(stringify({ op: kind, id, options: build(options, pk) })); } catch (e) {
        finish(reject, e instanceof TypeErr ? e : dom("NotAllowedError", "The operation either timed out or was not allowed."));
        return;
      }
      thenOf(request, (text) => {
        let reply;
        try { reply = parse(text); } catch (e) { reply = null; }
        if (!reply || !reply.ok) {
          const name = reply && reply.name, message = (reply && reply.message) || "The operation either timed out or was not allowed.";
          finish(reject, name === "TypeError" ? new TypeErr(message) : dom(name || "NotAllowedError", message));
          return;
        }
        try { finish(resolve, buildCredential(kind, reply.result)); } catch (e) { finish(reject, dom("NotAllowedError", "The passkey response could not be read.")); }
      }, () => finish(reject, dom("NotAllowedError", "The operation either timed out or was not allowed.")));
    });

    const wrap = (name, original, kind, build) => {
      const wrapped = {
        [name](options) {
          if (options && options.publicKey !== undefined && options.publicKey !== null) return ceremony(kind, options, options.publicKey, build);
          return apply(original, this, arguments);
        },
      }[name];
      defineProperty(wrapped, "length", { value: original.length, configurable: true });
      defineProperty(container, name, { value: wrapped, writable: true, configurable: true, enumerable: true });
    };
    wrap("create", origCreate, "create", toCreateOptions);
    wrap("get", origGet, "get", toGetOptions);

    const setStatic = (name, fn) => defineProperty(PKC, name, { value: fn, writable: true, configurable: true });
    setStatic("isUserVerifyingPlatformAuthenticatorAvailable", function isUserVerifyingPlatformAuthenticatorAvailable() { return P.resolve(true); });
    setStatic("isConditionalMediationAvailable", function isConditionalMediationAvailable() { return P.resolve(false); });
    if (typeof PKC.getClientCapabilities === "function") {
      setStatic("getClientCapabilities", function getClientCapabilities() {
        return P.resolve({ userVerifyingPlatformAuthenticator: true, passkeyPlatformAuthenticator: true, conditionalCreate: false, conditionalGet: false, hybridTransport: false, relatedOrigins: false });
      });
    }
  } catch (e) { /* A page must never break because passkeys could not be set up. */ }
})();
