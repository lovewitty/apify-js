import path from 'path';
import _ from 'underscore';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import 'babel-polyfill';
import sinon from 'sinon';
import Promise from 'bluebird';
import { delayPromise } from 'apify-shared/utilities';
import { ENV_VARS, ACT_JOB_STATUSES, LOCAL_ENV_VARS } from 'apify-shared/consts';
import { ApifyCallError } from '../build/errors';

chai.use(chaiAsPromised);

// NOTE: test use of require() here because this is how its done in acts
const Apify = require('../build/index');

/* global process, describe, it */

// TODO: override console.log() to test the error messages (now they are printed to console)

/*
let freePorts = [];
before(() => {
    // find free ports for testing
    return portastic.find({
        min: 50000,
        max: 51000,
    })
    .then((ports) => {
        freePorts = ports;
    });
});
const popFreePort = () => freePorts.pop();
*/


/**
 * Helper function that enables testing of Apify.main()
 * @returns Promise
 */
const testMain = ({ userFunc, exitCode }) => {
    // Mock process.exit() to check exit code and prevent process exit
    const processMock = sinon.mock(process);
    const exitExpectation = processMock
        .expects('exit')
        .withExactArgs(exitCode)
        .once()
        .returns();

    let error = null;

    return Promise.resolve()
        .then(() => {
            return new Promise((resolve, reject) => {
                // Invoke main() function, the promise resolves after the user function is run
                Apify.main(() => {
                    try {
                        // Wait for all tasks in Node.js event loop to finish
                        resolve();
                    } catch (err) {
                        reject(err);
                        return;
                    }
                    // Call user func to test other behavior (note that it can throw)
                    if (userFunc) return userFunc();
                });
            })
                .catch((err) => {
                    error = err;
                });
        })
        .then(() => {
            // Waits max 1000 millis for process.exit() mock to be called
            // console.log(`XXX: grand finale: ${err}`);
            return new Promise((resolve) => {
                const waitUntil = Date.now() + 1000;
                const intervalId = setInterval(() => {
                    // console.log('test for exitExpectation.called');
                    if (!exitExpectation.called && Date.now() < waitUntil) return;
                    clearInterval(intervalId);
                    // console.log(`exitExpectation.called: ${exitExpectation.called}`);
                    resolve();
                }, 10);
            });
        })
        .then(() => {
            if (error) throw error;
            processMock.verify();
        })
        .finally(() => {
            processMock.restore();
        });
};


const getEmptyEnv = () => {
    return {
        // internalPort: null,
        actId: null,
        actRunId: null,
        userId: null,
        token: null,
        startedAt: null,
        timeoutAt: null,
        defaultKeyValueStoreId: null,
        defaultDatasetId: null,
        memoryMbytes: null,
    };
};

const setEnv = (env) => {
    delete process.env.APIFY_INTERNAL_PORT;
    delete process.env.APIFY_ACT_ID;
    delete process.env.APIFY_ACT_RUN_ID;
    delete process.env.APIFY_USER_ID;
    delete process.env.APIFY_TOKEN;
    delete process.env.APIFY_STARTED_AT;
    delete process.env.APIFY_TIMEOUT_AT;
    delete process.env.APIFY_DEFAULT_KEY_VALUE_STORE_ID;
    delete process.env.APIFY_DEFAULT_DATASET_ID;

    // if (env.internalPort) process.env.APIFY_INTERNAL_PORT = env.internalPort.toString();
    if (env.actId) process.env.APIFY_ACT_ID = env.actId;
    if (env.actRunId) process.env.APIFY_ACT_RUN_ID = env.actRunId;
    if (env.userId) process.env.APIFY_USER_ID = env.userId;
    if (env.token) process.env.APIFY_TOKEN = env.token;
    if (env.startedAt) process.env.APIFY_STARTED_AT = env.startedAt.toISOString();
    if (env.timeoutAt) process.env.APIFY_TIMEOUT_AT = env.timeoutAt.toISOString();
    if (env.defaultKeyValueStoreId) process.env.APIFY_DEFAULT_KEY_VALUE_STORE_ID = env.defaultKeyValueStoreId;
    if (env.defaultDatasetId) process.env.APIFY_DEFAULT_DATASET_ID = env.defaultDatasetId;
    if (env.memoryMbytes) process.env.APIFY_MEMORY_MBYTES = env.memoryMbytes.toString();
};

describe('Apify.getEnv()', () => {
    it('works with null values', () => {
        const expectedEnv = getEmptyEnv();
        setEnv(expectedEnv);

        const env = Apify.getEnv();
        expect(env).to.eql(expectedEnv);
    });

    it('works with with non-null values', () => {
        const expectedEnv = _.extend(getEmptyEnv(), {
            // internalPort: 12345,
            actId: 'test actId',
            actRunId: 'test actId',
            userId: 'some user',
            token: 'auth token',
            startedAt: new Date('2017-01-01'),
            timeoutAt: new Date(),
            defaultKeyValueStoreId: 'some store',
            defaultDatasetId: 'some dataset',
            memoryMbytes: 1234,
        });
        setEnv(expectedEnv);

        const env = Apify.getEnv();
        expect(env).to.eql(expectedEnv);
    });
});


describe('Apify.main()', () => {
    it('throws on invalid args', () => {
        expect(() => {
            Apify.main();
        }).to.throw(Error);
    });

    it('works with simple user function', () => {
        return testMain({
            userFunc: () => {},
            exitCode: 0,
        });
    });

    it('sets default APIFY_LOCAL_STORAGE_DIR', async () => {
        delete process.env[ENV_VARS.LOCAL_STORAGE_DIR];
        delete process.env[ENV_VARS.TOKEN];

        await testMain({
            userFunc: () => {
                expect(process.env[ENV_VARS.LOCAL_STORAGE_DIR]).to.eql(path.join(process.cwd(), './apify_storage'));
            },
            exitCode: 0,
        });

        delete process.env[ENV_VARS.LOCAL_STORAGE_DIR];
    });

    it('works with promised user function', () => {
        let called = false;
        return testMain({
            userFunc: () => {
                return new Promise((resolve) => {
                    setTimeout(() => {
                        called = true;
                        // console.log('called = true');
                        resolve();
                    }, 20);
                });
            },
            exitCode: 0,
        })
            .then(() => {
                expect(called).to.eql(true);
            });
    });

    it('on exception in simple user function the process exits with code 91', () => {
        return testMain({
            userFunc: () => {
                throw new Error('Test exception I');
            },
            exitCode: 91,
        });
    });

    it('on exception in promised user function the process exits with code 91', () => {
        return testMain({
            userFunc: () => {
                return delayPromise(20)
                    .then(() => {
                        throw new Error('Text exception II');
                    });
            },
            exitCode: 91,
        });
    });
});

describe('Apify.call()', () => {
    it('works as expected', () => {
        const actId = 'some-act-id';
        const token = 'some-token';
        const defaultKeyValueStoreId = 'some-store-id';
        const run = { id: 'some-run-id', actId, defaultKeyValueStoreId };
        const runningRun = Object.assign({}, run, { status: ACT_JOB_STATUSES.RUNNING });
        const finishedRun = Object.assign({}, run, { status: ACT_JOB_STATUSES.SUCCEEDED });
        const input = 'something';
        const contentType = 'text/plain';
        const output = { contentType, body: 'some-output' };
        const expected = Object.assign({}, finishedRun, { output });
        const build = 'xxx';
        const memory = 1024;

        const actsMock = sinon.mock(Apify.client.acts);
        actsMock.expects('runAct')
            .withExactArgs({ token, actId, contentType: `${contentType}; charset=utf-8`, body: input, build, memory })
            .once()
            .returns(Promise.resolve(runningRun));
        actsMock.expects('getRun')
            .withExactArgs({ token, actId, runId: run.id, waitForFinish: 999999 })
            .once()
            .returns(Promise.resolve(runningRun));
        actsMock.expects('getRun')
            .withExactArgs({ token, actId, runId: run.id, waitForFinish: 999999 })
            .once()
            .returns(Promise.resolve(finishedRun));

        const keyValueStoresMock = sinon.mock(Apify.client.keyValueStores);
        keyValueStoresMock.expects('getRecord')
            .withExactArgs({ storeId: run.defaultKeyValueStoreId, key: 'OUTPUT', disableBodyParser: true })
            .once()
            .returns(Promise.resolve(output));

        return Apify
            .call(actId, input, { contentType, token, disableBodyParser: true, build, memory })
            .then((callOutput) => {
                expect(callOutput).to.be.eql(expected);
                keyValueStoresMock.restore();
                actsMock.restore();
            });
    });

    it('works without opts and input', () => {
        const actId = 'some-act-id';
        const token = 'token';
        const defaultKeyValueStoreId = 'some-store-id';
        const run = { id: 'some-run-id', actId, defaultKeyValueStoreId };
        const runningRun = Object.assign({}, run, { status: ACT_JOB_STATUSES.RUNNING });
        const finishedRun = Object.assign({}, run, { status: ACT_JOB_STATUSES.SUCCEEDED });
        const output = 'some-output';
        const expected = Object.assign({}, finishedRun, { output });

        Apify.client.setOptions({ token });

        const actsMock = sinon.mock(Apify.client.acts);
        actsMock.expects('runAct')
            .withExactArgs({ actId })
            .once()
            .returns(Promise.resolve(runningRun));
        actsMock.expects('getRun')
            .withExactArgs({ actId, runId: run.id, waitForFinish: 999999 })
            .once()
            .returns(Promise.resolve(runningRun));
        actsMock.expects('getRun')
            .withExactArgs({ actId, runId: run.id, waitForFinish: 999999 })
            .once()
            .returns(Promise.resolve(finishedRun));

        const keyValueStoresMock = sinon.mock(Apify.client.keyValueStores);
        keyValueStoresMock.expects('getRecord')
            .withExactArgs({ storeId: run.defaultKeyValueStoreId, key: 'OUTPUT' })
            .once()
            .returns(Promise.resolve(output));

        return Apify
            .call(actId)
            .then((callOutput) => {
                expect(callOutput).to.be.eql(expected);
                keyValueStoresMock.restore();
                actsMock.restore();
            });
    });

    it('works without opts with null input', () => {
        const actId = 'some-act-id';
        const token = 'token';
        const defaultKeyValueStoreId = 'some-store-id';
        const run = { id: 'some-run-id', actId, defaultKeyValueStoreId };
        const runningRun = Object.assign({}, run, { status: ACT_JOB_STATUSES.RUNNING });
        const finishedRun = Object.assign({}, run, { status: ACT_JOB_STATUSES.SUCCEEDED });
        const output = 'some-output';
        const expected = Object.assign({}, finishedRun, { output });

        Apify.client.setOptions({ token });

        const actsMock = sinon.mock(Apify.client.acts);
        actsMock.expects('runAct')
            .withExactArgs({ actId })
            .once()
            .returns(Promise.resolve(runningRun));
        actsMock.expects('getRun')
            .withExactArgs({ actId, runId: run.id, waitForFinish: 999999 })
            .once()
            .returns(Promise.resolve(runningRun));
        actsMock.expects('getRun')
            .withExactArgs({ actId, runId: run.id, waitForFinish: 999999 })
            .once()
            .returns(Promise.resolve(finishedRun));

        const keyValueStoresMock = sinon.mock(Apify.client.keyValueStores);
        keyValueStoresMock.expects('getRecord')
            .withExactArgs({ storeId: run.defaultKeyValueStoreId, key: 'OUTPUT' })
            .once()
            .returns(Promise.resolve(output));

        return Apify
            .call(actId, null)
            .then((callOutput) => {
                expect(callOutput).to.be.eql(expected);
                keyValueStoresMock.restore();
                actsMock.restore();
            });
    });

    it('works without opts with non-null input', () => {
        const actId = 'some-act-id';
        const token = 'token';
        const defaultKeyValueStoreId = 'some-store-id';
        const run = { id: 'some-run-id', actId, defaultKeyValueStoreId };
        const runningRun = Object.assign({}, run, { status: ACT_JOB_STATUSES.RUNNING });
        const finishedRun = Object.assign({}, run, { status: ACT_JOB_STATUSES.SUCCEEDED });
        const input = { a: 'b' };
        const output = 'some-output';
        const expected = Object.assign({}, finishedRun, { output });

        Apify.client.setOptions({ token });

        const actsMock = sinon.mock(Apify.client.acts);
        actsMock.expects('runAct')
            .withExactArgs({ actId, contentType: 'application/json; charset=utf-8', body: JSON.stringify(input, null, 2) })
            .once()
            .returns(Promise.resolve(runningRun));

        actsMock.expects('getRun')
            .withExactArgs({ actId, runId: run.id, waitForFinish: 999999 })
            .once()
            .returns(Promise.resolve(runningRun));
        actsMock.expects('getRun')
            .withExactArgs({ actId, runId: run.id, waitForFinish: 999999 })
            .once()
            .returns(Promise.resolve(finishedRun));

        const keyValueStoresMock = sinon.mock(Apify.client.keyValueStores);
        keyValueStoresMock.expects('getRecord')
            .withExactArgs({ storeId: run.defaultKeyValueStoreId, key: 'OUTPUT' })
            .once()
            .returns(Promise.resolve(output));

        return Apify
            .call(actId, input)
            .then((callOutput) => {
                expect(callOutput).to.be.eql(expected);
                keyValueStoresMock.restore();
                actsMock.restore();
            });
    });

    it('stringifies to JSON', () => {
        const actId = 'some-act-id';
        const token = 'some-token';
        const defaultKeyValueStoreId = 'some-store-id';
        const run = { id: 'some-run-id', actId, defaultKeyValueStoreId };
        const runningRun = Object.assign({}, run, { status: ACT_JOB_STATUSES.RUNNING });
        const finishedRun = Object.assign({}, run, { status: ACT_JOB_STATUSES.SUCCEEDED });
        const input = { a: 'b' };
        const output = { body: 'some-output' };
        const expected = Object.assign({}, finishedRun, { output });
        const build = 'xxx';

        const actsMock = sinon.mock(Apify.client.acts);
        actsMock.expects('runAct')
            .withExactArgs({ token, actId, contentType: 'application/json; charset=utf-8', body: JSON.stringify(input, null, 2), build })
            .once()
            .returns(Promise.resolve(runningRun));
        actsMock.expects('getRun')
            .withExactArgs({ token, actId, runId: run.id, waitForFinish: 999999 })
            .once()
            .returns(Promise.resolve(runningRun));
        actsMock.expects('getRun')
            .withExactArgs({ token, actId, runId: run.id, waitForFinish: 999999 })
            .once()
            .returns(Promise.resolve(finishedRun));

        const keyValueStoresMock = sinon.mock(Apify.client.keyValueStores);
        keyValueStoresMock.expects('getRecord')
            .withExactArgs({ storeId: run.defaultKeyValueStoreId, key: 'OUTPUT', disableBodyParser: true })
            .once()
            .returns(Promise.resolve(output));

        return Apify
            .call(actId, input, { token, disableBodyParser: true, build })
            .then((callOutput) => {
                expect(callOutput).to.be.eql(expected);
                keyValueStoresMock.restore();
                actsMock.restore();
            });
    });

    it('works as expected with fetchOutput = false', () => {
        const actId = 'some-act-id';
        const token = 'some-token';
        const defaultKeyValueStoreId = 'some-store-id';
        const run = { id: 'some-run-id', actId, defaultKeyValueStoreId };
        const runningRun = Object.assign({}, run, { status: ACT_JOB_STATUSES.RUNNING });
        const finishedRun = Object.assign({}, run, { status: ACT_JOB_STATUSES.SUCCEEDED });

        const actsMock = sinon.mock(Apify.client.acts);
        actsMock.expects('runAct')
            .withExactArgs({ token, actId })
            .once()
            .returns(Promise.resolve(runningRun));
        actsMock.expects('getRun')
            .withExactArgs({ token, actId, runId: run.id, waitForFinish: 999999 })
            .once()
            .returns(Promise.resolve(runningRun));
        actsMock.expects('getRun')
            .withExactArgs({ token, actId, runId: run.id, waitForFinish: 999999 })
            .once()
            .returns(Promise.resolve(finishedRun));

        const keyValueStoresMock = sinon.mock(Apify.client.keyValueStores);
        keyValueStoresMock.expects('getRecord').never();

        return Apify
            .call(actId, null, { token, fetchOutput: false })
            .then((callOutput) => {
                expect(callOutput).to.be.eql(finishedRun);
                keyValueStoresMock.restore();
                actsMock.restore();
            });
    });

    it('timeouts as expected with unfinished run', () => {
        const actId = 'some-act-id';
        const token = 'some-token';
        const defaultKeyValueStoreId = 'some-store-id';
        const run = { id: 'some-run-id', actId, defaultKeyValueStoreId };
        const runningRun = Object.assign({}, run, { status: ACT_JOB_STATUSES.RUNNING });
        const waitSecs = 1;

        const actsMock = sinon.mock(Apify.client.acts);
        actsMock.expects('runAct')
            .withExactArgs({ token, actId })
            .once()
            .returns(Promise.resolve(runningRun));
        actsMock.expects('getRun')
            .withExactArgs({ token, actId, runId: run.id, waitForFinish: waitSecs })
            .once()
            .returns(new Promise((resolve) => {
                setTimeout(() => resolve(runningRun), waitSecs * 1000);
            }));

        const keyValueStoresMock = sinon.mock(Apify.client.keyValueStores);
        keyValueStoresMock.expects('getRecord').never();

        return Apify
            .call(actId, null, { token, waitSecs })
            .then((callOutput) => {
                expect(callOutput).to.be.eql(runningRun);
                keyValueStoresMock.restore();
                actsMock.restore();
            });
    });

    it('handles getRun() returning null the first time', () => {
        const actId = 'some-act-id';
        const token = 'some-token';
        const defaultKeyValueStoreId = 'some-store-id';
        const run = { id: 'some-run-id', actId, defaultKeyValueStoreId };
        const runningRun = Object.assign({}, run, { status: ACT_JOB_STATUSES.RUNNING });
        const finishedRun = Object.assign({}, run, { status: ACT_JOB_STATUSES.SUCCEEDED });
        const input = 'something';
        const contentType = 'text/plain';
        const output = { contentType, body: 'some-output' };
        const expected = Object.assign({}, finishedRun, { output });
        const build = 'xxx';

        const actsMock = sinon.mock(Apify.client.acts);
        actsMock.expects('runAct')
            .withExactArgs({ token, actId, contentType: `${contentType}; charset=utf-8`, body: input, build })
            .once()
            .returns(Promise.resolve(runningRun));
        actsMock.expects('getRun')
            .withExactArgs({ token, actId, runId: run.id, waitForFinish: 999999 })
            .twice()
            .returns(Promise.resolve(null));
        actsMock.expects('getRun')
            .withExactArgs({ token, actId, runId: run.id, waitForFinish: 999999 })
            .once()
            .returns(Promise.resolve(finishedRun));

        const keyValueStoresMock = sinon.mock(Apify.client.keyValueStores);
        keyValueStoresMock.expects('getRecord')
            .withExactArgs({ storeId: run.defaultKeyValueStoreId, key: 'OUTPUT', disableBodyParser: true })
            .once()
            .returns(Promise.resolve(output));

        return Apify
            .call(actId, input, { contentType, token, disableBodyParser: true, build })
            .then((callOutput) => {
                expect(callOutput).to.be.eql(expected);
                keyValueStoresMock.restore();
                actsMock.restore();
            });
    });

    it('returns immediately with zero timeout', () => {
        const actId = 'some-act-id';
        const token = 'some-token';
        const defaultKeyValueStoreId = 'some-store-id';
        const run = { id: 'some-run-id', actId, defaultKeyValueStoreId };
        const readyRun = Object.assign({}, run, { status: ACT_JOB_STATUSES.READY });
        const waitSecs = 0;

        const actsMock = sinon.mock(Apify.client.acts);
        actsMock.expects('runAct')
            .withExactArgs({ token, actId })
            .once()
            .returns(Promise.resolve(readyRun));
        actsMock.expects('getRun').never();

        const keyValueStoresMock = sinon.mock(Apify.client.keyValueStores);
        keyValueStoresMock.expects('getRecord').never();

        return Apify
            .call(actId, null, { token, waitSecs })
            .then((callOutput) => {
                expect(callOutput).to.be.eql(readyRun);
                keyValueStoresMock.restore();
                actsMock.restore();
            });
    });

    it('throws if run doesn\'t succeed', () => {
        const actId = 'some-act-id';
        const token = 'some-token';
        const run = { id: 'some-run-id' };
        const runningRun = Object.assign({}, run, { status: ACT_JOB_STATUSES.RUNNING });
        const failedRun = Object.assign({}, run, { status: ACT_JOB_STATUSES.ABORTED });

        const actsMock = sinon.mock(Apify.client.acts);
        actsMock.expects('runAct')
            .withExactArgs({ token, actId })
            .once()
            .returns(Promise.resolve(runningRun));
        actsMock.expects('getRun')
            .withExactArgs({ token, actId, runId: run.id, waitForFinish: 999999 })
            .once()
            .returns(Promise.resolve(failedRun));

        return Apify
            .call(actId, null, { token })
            .then(() => { throw new Error('This was suppose to fail!'); }, (err) => {
                expect(err).to.be.instanceOf(ApifyCallError);
                expect(err.run.status).to.be.eql(ACT_JOB_STATUSES.ABORTED);
                expect(err.run).to.be.eql(failedRun);
            });
    });
});

describe('Apify.getApifyProxyUrl()', () => {
    it('should work', () => {
        process.env[ENV_VARS.PROXY_PASSWORD] = 'abc123';
        process.env[ENV_VARS.PROXY_HOSTNAME] = 'my.host.com';
        process.env[ENV_VARS.PROXY_PORT] = 123;

        expect(Apify.getApifyProxyUrl({
            session: 'XYZ',
            groups: ['g1', 'g2', 'g3'],
        })).to.be.eql('http://groups-g1+g2+g3,session-XYZ:abc123@my.host.com:123');

        expect(Apify.getApifyProxyUrl({
            groups: ['g1', 'g2', 'g3'],
        })).to.be.eql('http://groups-g1+g2+g3:abc123@my.host.com:123');

        expect(Apify.getApifyProxyUrl({
            session: 'XYZ',
        })).to.be.eql('http://session-XYZ:abc123@my.host.com:123');

        expect(Apify.getApifyProxyUrl()).to.be.eql('http://auto:abc123@my.host.com:123');

        delete process.env[ENV_VARS.PROXY_PASSWORD];
        delete process.env[ENV_VARS.PROXY_HOSTNAME];
        delete process.env[ENV_VARS.PROXY_PORT];

        expect(Apify.getApifyProxyUrl({ password: 'xyz' }))
            .to.be.eql(`http://auto:xyz@${LOCAL_ENV_VARS[ENV_VARS.PROXY_HOSTNAME]}:${LOCAL_ENV_VARS[ENV_VARS.PROXY_PORT]}`);

        expect(() => Apify.getApifyProxyUrl()).to.throw();

        expect(Apify.getApifyProxyUrl({
            password: 'xyz',
            hostname: 'your.host.com',
            port: 345,
        })).to.be.eql('http://auto:xyz@your.host.com:345');
    });

    // Test old params - session, groups
    it('should be backwards compatible', () => {
        process.env[ENV_VARS.PROXY_PASSWORD] = 'abc123';
        process.env[ENV_VARS.PROXY_HOSTNAME] = 'my.host.com';
        process.env[ENV_VARS.PROXY_PORT] = 123;

        expect(Apify.getApifyProxyUrl({
            apifyProxySession: 'XYZ',
            apifyProxyGroups: ['g1', 'g2', 'g3'],
        })).to.be.eql('http://groups-g1+g2+g3,session-XYZ:abc123@my.host.com:123');

        expect(Apify.getApifyProxyUrl({
            apifyProxyGroups: ['g1', 'g2', 'g3'],
        })).to.be.eql('http://groups-g1+g2+g3:abc123@my.host.com:123');

        expect(Apify.getApifyProxyUrl({
            apifyProxySession: 'XYZ',
        })).to.be.eql('http://session-XYZ:abc123@my.host.com:123');

        expect(Apify.getApifyProxyUrl()).to.be.eql('http://auto:abc123@my.host.com:123');

        delete process.env[ENV_VARS.PROXY_PASSWORD];
        delete process.env[ENV_VARS.PROXY_HOSTNAME];
        delete process.env[ENV_VARS.PROXY_PORT];

        expect(Apify.getApifyProxyUrl({ password: 'xyz' }))
            .to.be.eql(`http://auto:xyz@${LOCAL_ENV_VARS[ENV_VARS.PROXY_HOSTNAME]}:${LOCAL_ENV_VARS[ENV_VARS.PROXY_PORT]}`);

        expect(() => Apify.getApifyProxyUrl()).to.throw();

        expect(Apify.getApifyProxyUrl({
            password: 'xyz',
            hostname: 'your.host.com',
            port: 345,
        })).to.be.eql('http://auto:xyz@your.host.com:345');
    });

    it('should throw on invalid proxy args', () => {
        process.env[ENV_VARS.PROXY_PASSWORD] = 'abc123';
        process.env[ENV_VARS.PROXY_HOSTNAME] = 'my.host.com';
        process.env[ENV_VARS.PROXY_PORT] = 123;

        expect(() => Apify.getApifyProxyUrl({ session: 'a-b' })).to.throw();
        expect(() => Apify.getApifyProxyUrl({ session: 'a$b' })).to.throw();
        expect(() => Apify.getApifyProxyUrl({ session: {} })).to.throw();
        expect(() => Apify.getApifyProxyUrl({ session: new Date() })).to.throw();
        expect(() => Apify.getApifyProxyUrl({ apifyProxySession: new Date() })).to.throw();

        expect(() => Apify.getApifyProxyUrl({ session: 'a_b' })).to.not.throw();
        expect(() => Apify.getApifyProxyUrl({ session: '0.34252352' })).to.not.throw();
        expect(() => Apify.getApifyProxyUrl({ session: 'aaa~BBB' })).to.not.throw();
        expect(() => Apify.getApifyProxyUrl({ session: 'a_1_b' })).to.not.throw();
        expect(() => Apify.getApifyProxyUrl({ session: 'a_2' })).to.not.throw();
        expect(() => Apify.getApifyProxyUrl({ session: 'a' })).to.not.throw();
        expect(() => Apify.getApifyProxyUrl({ session: '1' })).to.not.throw();

        expect(() => Apify.getApifyProxyUrl({ groups: [new Date()] })).to.throw();
        expect(() => Apify.getApifyProxyUrl({ groups: [{}, 'fff', 'ccc'] })).to.throw();
        expect(() => Apify.getApifyProxyUrl({ groups: ['ffff', 'ff-hf', 'ccc'] })).to.throw();
        expect(() => Apify.getApifyProxyUrl({ groups: ['ffff', 'fff', 'cc$c'] })).to.throw();
        expect(() => Apify.getApifyProxyUrl({ apifyProxyGroups: [new Date()] })).to.throw();

        delete process.env[ENV_VARS.PROXY_PASSWORD];
        delete process.env[ENV_VARS.PROXY_HOSTNAME];
        delete process.env[ENV_VARS.PROXY_PORT];
    });
});
