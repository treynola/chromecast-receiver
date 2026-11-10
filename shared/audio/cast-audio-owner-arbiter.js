(function installCastAudioOwnerArbiter(window) {
  "use strict";
        class CastAudioOwnerArbiter {
          constructor() {
            this.owner = "none";
            this.generation = -1;
            this.reason = "initial";
          }

          begin(generation, reason = "bridge_open", { preserveOwner = false } = {}) {
            const nextGeneration = Number(generation);
            if (!Number.isSafeInteger(nextGeneration) || nextGeneration < this.generation) {
              return false;
            }
            if (!(preserveOwner && this.owner !== "none")) {
              this.owner = "none";
            }
            this.generation = nextGeneration;
            this.reason = reason || this.reason;
            return true;
          }

          claim(owner, generation, reason = "owner_claim") {
            const nextGeneration = Number(generation);
            if (
              typeof owner !== "string" ||
              owner === "" ||
              !Number.isSafeInteger(nextGeneration) ||
              nextGeneration !== this.generation
            ) {
              return false;
            }
            if (this.owner !== "none" && this.owner !== owner) {
              return false;
            }
            this.owner = owner;
            this.reason = reason || this.reason;
            return true;
          }

          promote(expectedOwner, nextOwner, generation, reason = "owner_promote") {
            const nextGeneration = Number(generation);
            if (
              typeof expectedOwner !== "string" ||
              expectedOwner === "" ||
              typeof nextOwner !== "string" ||
              nextOwner === "" ||
              !Number.isSafeInteger(nextGeneration) ||
              nextGeneration !== this.generation ||
              this.owner !== expectedOwner
            ) {
              return false;
            }
            this.owner = nextOwner;
            this.reason = reason || this.reason;
            return true;
          }

          release(owner, generation, reason = "owner_release") {
            const nextGeneration = Number(generation);
            if (
              !Number.isSafeInteger(nextGeneration) ||
              nextGeneration !== this.generation ||
              (owner && this.owner !== "none" && this.owner !== owner)
            ) {
              return false;
            }
            this.owner = "none";
            this.reason = reason || this.reason;
            return true;
          }

          owns(owner, generation) {
            return (
              this.owner === owner &&
              Number(generation) === this.generation
            );
          }

          snapshot() {
            return {
              owner: this.owner,
              generation: this.generation,
              reason: this.reason,
            };
          }
        }
  Object.defineProperty(window, "MXSCastAudioOwnerArbiter", {
    value: Object.freeze(CastAudioOwnerArbiter),
    writable: false,
    configurable: false,
    enumerable: true,
  });
})(window);
