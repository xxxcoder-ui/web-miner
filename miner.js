class FactsUI {
    constructor() {
        this._peers = document.getElementById('factPeers');
        this._blockHeight = document.getElementById('factBlockHeight');
        this._myHashrate = document.getElementById('factMyHashrate');
        this._myHashrateUnit = document.getElementById('factMyHashrateUnit');
        this._globalHashrate = document.getElementById('factGlobalHashrate');
        this._globalHashrateUnit = document.getElementById('factGlobalHashrateUnit');
        this._myBalance = document.getElementById('factBalance');
        this._expectedHashTime = document.getElementById('factExpectedHashTime');
        this._blockProcessingState = document.getElementById('factBlockProcessingState');
        this._consensusProgress = document.getElementById('progress');
        this._miningSection = document.getElementById('miningSection');
    }

    set peers(peers) {
        this._peers.textContent = peers;
    }

    set blockHeight(height) {
        this._blockHeight.textContent = height;
    }

    set myHashrate(hashrate){
        this._setHashrate(hashrate, 'my');
    }

    set globalHashrate(hashrate){
        this._setHashrate(hashrate, 'global');
    }

    set expectedHashTime(expectedHashTime) {
        if (!Number.isFinite(expectedHashTime)) {
            return;
        }
        // the time is given in seconds. Convert it to an appropriate base unit:
        let timesteps = [{unit:'minutes', factor:60}, {unit:'hours', factor:60}, {unit:'days', factor:24},
            {unit:'months', factor:365/12}, {unit:'years', factor:12}, {unit:'decades', factor:10}];
        let convertedTime = expectedHashTime;
        let unit = 'seconds';
        for (let i=0; i<timesteps.length; ++i) {
            let timestep = timesteps[i];
            if (convertedTime / timestep.factor < 1) {
                break;
            } else {
                convertedTime /= timestep.factor;
                unit = timestep.unit;
            }
        }
        this._expectedHashTime.textContent = convertedTime.toFixed(1)+' '+unit;
    }

    set myBalance(balance) {
        this._myBalance.textContent = Nimiq.Policy.satoshisToCoins(balance).toFixed(2);
    }

    set syncing(isSyncing) {
        if (isSyncing) {
            console.log('synchronization state: syncing');
            this._blockProcessingState.textContent = "Fetching";
            this._consensusProgress.textContent = "Synchronizing";
            this._miningSection.classList.remove('synced');
            this._miningSection.offsetWidth; // enforce an update
            this._miningSection.classList.add('syncing');
        } else {
            console.log('synchronization state: synced');
            this._blockProcessingState.textContent = "Mining on";
            this._miningSection.classList.remove('syncing');
            this._miningSection.offsetWidth; // enforce an update
            this._miningSection.classList.add('synced');
            setTimeout(function() {
                // change the text when the _consensusProgress is faded out by the synced class
                this._consensusProgress.textContent = "Consensus established";
            }.bind(this), 1500);
        }
    }

    _setHashrate(hashrate, type) {
        let steps = ['k', 'M', 'G', 'T', 'P', 'E']; // kilo, mega, giga, tera, peta, exa
        let prefix = '';
        for (let i=0, step; step=steps[i]; ++i) {
            if (hashrate / 1000 < 1) {
                break;
            } else {
                hashrate /= 1000;
                prefix = step;
            }
        }
        let unit = prefix+'H/s';
        let hashrateEl, unitEl;
        if (type === 'global') {
            hashrateEl = this._globalHashrate;
            unitEl = this._globalHashrateUnit;
        } else {
            hashrateEl = this._myHashrate;
            unitEl = this._myHashrateUnit;
        }
        hashrateEl.textContent = hashrate.toFixed(2);
        unitEl.textContent = unit;
    }
}

class MinerUI {
    constructor() {
        this.connBtn = document.getElementById('connBtn');
        this._progressBar = document.getElementById('progressBar');
        this.facts = new FactsUI();
        this._sections = {
            'landing': document.getElementById("startSection"),
            'mining': document.getElementById("miningSection")
        };
    }

    setState(newState) {
        let states = ['landing', 'mining'];
        states.forEach(function(state) {
            let style = this._sections[state].style;
            if (state === newState) {
                setTimeout(function() {
                    // show as soon as the other page is hidden
                    style.display = 'block';
                    this._sections[state].offsetWidth; // enforce style update
                    style.opacity = 1; // fades for 1s
                }.bind(this), 1000);
            } else {
                style.opacity = 0; // fades for 1s
                setTimeout(function() {
                    style.display = 'none';
                }, 1000);
            }
        }, this);
    }

    set syncProgress(progress) {
        this._progressBar.style.transform = 'scaleX('+Math.min(1, progress)+') translateZ(0)';
    }

    enableConnectButton() {
        this.connBtn.style.display = 'inline-block';
    }
}

class MapUI {
    constructor($) {
        this._map = new Map(document.querySelector('#map svg'));
        this.$ = $;
        this._polled = [];
        this._connectedPeers = new Nimiq.HashMap();
        this._knownPeers = new Nimiq.HashMap();
        this._cellCount = {};

        $.network.on('peer-joined', peer => this._onPeerJoined(peer));
        $.network.on('peer-left', peer => this._onPeerLeft(peer));
        setInterval(this._pollPeers.bind(this), MapUI.REFRESH_INTERVAL);

        GeoIP.retrieveOwn(response => this._highlightOwnPeer(response));
    }

    _onPeerJoined(peer) {
        var netAddr = peer.netAddress;
        if (netAddr && !this._connectedPeers.contains(peer.peerAddress)) {
            GeoIP.retrieve(response => this._highlightConnectedPeer(peer.peerAddress, response), netAddr.host);
        }
    }

    _onPeerLeft(peer) {
        var cell = this._connectedPeers.get(peer.peerAddress);
        if (cell) {
            // Only remove highlight if there are no more peers on this cell.
            if (this._decCellCount(cell) === 0) {
                this._map.unhighlightCell(cell);
            }
            this._connectedPeers.remove(peer.peerAddress);
        }
    }

    _noise(lat, lng) {
        return  (1 - Math.random()*2) * 0.5;
    }

    _incCellCount(cell) {
        if (!this._cellCount[cell]) {
            this._cellCount[cell] = 0;
        }
        this._cellCount[cell]++;
    }

    _decCellCount(cell) {
        if (!this._cellCount[cell]) {
            this._cellCount[cell] = 0;
        }
        if (this._cellCount[cell] > 0) {
            return --this._cellCount[cell];
        }
        return 0;
    }

    _highlightOwnPeer(response) {
        if (response && response.location && response.location.latitude) {
            var loc = response.location;
            var cell = this._map.highlightLocation(loc.latitude, loc.longitude, 'own-peer');
            if (cell) {
                this._ownCell = cell;
                this._incCellCount(cell);
            }
        }
    }

    _highlightConnectedPeer(addr, response) {
        if (response && response.location && response.location.latitude) {
            var loc = response.location;
            var cell = this._map.highlightLocation(loc.latitude + this._noise(), loc.longitude + this._noise(), 'connected-peer');
            if (cell) {
                this._connectedPeers.put(addr, cell);
                this._incCellCount(cell);
            }
        }
    }

    _highlightKnownPeer(addr, response) {
        if (response && response.location && response.location.latitude) {
            var loc = response.location;
            var cell = this._map.highlightLocation(loc.latitude + this._noise(), loc.longitude + this._noise(), 'known-peer');
            if (cell) {
                var numKnown = this._knownPeers.length;
                this._knownPeers.put(addr, cell);
                // if too many are already highlighted, remove a random one
                if (numKnown >= MapUI.KNOWN_PEERS_MAX) {
                    var i = Math.floor(Math.random() * numKnown);
                    var addr = this._knownPeers.keys()[i];
                    var cell = this._knownPeers.get(addr);
                    if (this._decCellCount(cell) === 0) {
                        this._map.unhighlightCell(cell);
                    }
                    this._knownPeers.remove(addr);
                }
            }
        }
    }

    _pollPeers() {
        if (this._polled.length === 0) {
            this._polled = this.$.network._addresses.query(Nimiq.Protocol.WS, Nimiq.Services.DEFAULT);
            // choose random subset
            var index = Math.floor(Math.random() * (this._polled.length + 1));
            this._polled = this._polled.splice(index, 10);
        }
        if (this._polled.length > 0) {
            var wsAddr = this._polled.shift();
            if (!this._connectedPeers.contains(wsAddr)) {
                // only highlight if not connected to this peer
                GeoIP.retrieve(response => this._highlightKnownPeer(wsAddr, response), wsAddr.host);
            }
        }
    }
}
MapUI.KNOWN_PEERS_MAX = 20;
MapUI.REFRESH_INTERVAL = 1000;

class Miner {
    constructor($) {
        this.ui = new MinerUI();
        this.ui.connBtn.onclick = () => this._connect($);
        this.ui.enableConnectButton();
        this.syncing = true;
        this.map = new MapUI($);
    }

    _initCore($) {
        this.$ = $;

        $.consensus.on('established', () => this._onConsensusEstablished());
        $.consensus.on('lost', () => this._onConsensusLost());
        $.consensus.on('syncing', _targetHeight => this._onSyncing(_targetHeight));

        $.blockchain.on('head-changed', _ => this._onHeadChanged());
        $.network.on('peers-changed', () => this._onPeersChanged());
        $.miner.on('hashrate-changed', () => this._onHashrateChanged());

        $.network.connect();

        this._onHeadChanged();
    }

    get hashrate() {
        return this.$.miner.hashrate;
    }

    get globalHashrate() {
        const nBits = this.$.blockchain.head.header.nBits;
        const difficulty = Nimiq.BlockUtils.compactToDifficulty(nBits);
        return difficulty * 2**16 / Nimiq.Policy.BLOCK_TIME;
    }

    _onConsensusEstablished() {
        // TODO the core can switch between syncing and consensus multiple times, so this method
        // can be called multiple times
        this.$.accounts.getBalance(this.$.wallet.address)
            .then(balance => this._onBalanceChanged(balance));
        this.$.accounts.on(this.$.wallet.address, balance => this._onBalanceChanged(balance));

        this.$.miner.startWork();

        this.ui.facts.syncing = false;
        this.syncing = false;
        this.ui.syncProgress = 1;

        this._onGlobalHashrateChanged();
    }

    _onConsensusLost() {
        this.$.miner.stopWork();
    }

    _onSyncing(targetHeight) {
        this._targetHeight = targetHeight;
        this.ui.facts.syncing = true;
        this.syncing = true;
    }

    _onPeersChanged() {
        this.ui.facts.peers = this.$.network.peerCount;
    }

    _onHeadChanged() {
        const height = this.$.blockchain.height;
        this.ui.facts.blockHeight = height;
        if (this.syncing) {
            this.ui.syncProgress = height / this._targetHeight;
        } else {
            this._onGlobalHashrateChanged();
        }
    }

    _onGlobalHashrateChanged() {
        this.ui.facts.globalHashrate = this.globalHashrate;
        this._onExpectedHashTimeChanged();
    }

    _onHashrateChanged(){
        this.ui.facts.myHashrate = this.hashrate;
        this._onExpectedHashTimeChanged();
    }

    _onExpectedHashTimeChanged() {
        const myWinProbability = this.hashrate / this.globalHashrate;
        this.ui.facts.expectedHashTime = (1 / myWinProbability) * Nimiq.Policy.BLOCK_TIME;
    }

    _onBalanceChanged(balance) {
        this.ui.facts.myBalance = balance.value;
    }

    _connect($) {
        this.ui.setState('mining');
        this._initCore($)
    }
}

// Initialize Nimiq Core.
Nimiq.init($ => {
    // When all other tabs are closed, the success case gets invoked.
    document.getElementById('warning-multiple-tabs').style.display = 'none';
    window.Miner = new Miner($);
}, function(error) {
    if (error === Nimiq.ERR_WAIT) {
        document.getElementById('warning-multiple-tabs').style.display = 'block';
    } else if (error === Nimiq.ERR_UNSUPPORTED) {
        document.getElementById('warning-old-browser').style.display = 'block';
    } else {
        document.getElementById('warning-general-error').style.display = 'block';
    }
});
