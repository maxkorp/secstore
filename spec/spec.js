'use strict'; // eslint-disable-line strict

const cp = require('child_process');
const expect = require('chaimel');
const fse = require('fs-extra-promise');
const path = require('path');
const secureStorage = require('../');
const uuid = require('uuid');

const inputFixturePath = path.join(__dirname, 'input-fixture.json');
const inputFixture = fse.readJsonSync(inputFixturePath);
const password = uuid.v4();

fse.removeSync(path.join(__dirname, 'tmp'));
fse.ensureDirSync(path.join(__dirname, 'tmp'));

const getValidAlgosForTesting = () => {
  const algos = {
    aes256: '(default)',
    aes192: '',
    rc4: '(seriously, don\'t use this)',
    bf: '',
    blowfish: ''
  };

  const openssl = cp.execSync('openssl list-cipher-commands').toString().split('\n');

  const output = {};
  Object.keys(algos).forEach((algo) => {
    if (openssl.indexOf(algo) >= 0) {
      output[algo] = algos[algo];
    }
  });
  return output;
};

const encryptWithOpenSSL = (inputFile, outputFile, algo) => {
  const cmd = [
    'openssl',
    algo,
    '-e',
    '-in',
    inputFile,
    '-out',
    outputFile,
    '-nosalt',
    '-k',
    password
  ].join(' ');
  return cp.execSync(cmd);
};

// disabled linter for this as another test will use it
// const decryptWithOpenSSL = (inputFile, algo) => { // eslint-disable-line no-unused-vars
//   const cmd = [
//     'openssl',
//     algo,
//     '-e',
//     '-in',
//     inputFile,
//     '-nosalt'
//   ].join(' ');
//   return cp.execSync(cmd);
// };

describe(`secure-storage (Using password: ${password})`, () => {
  beforeEach(() => {
    fse.removeSync(path.join(__dirname, 'tmp'));
    fse.ensureDirSync(path.join(__dirname, 'tmp'));
  });

  const algos = getValidAlgosForTesting();
  Object.keys(algos).forEach((algo) => {
    const message = algos[algo];
    const opensslOutputFilePath = path.join(__dirname, 'tmp', `openssl-encrypted-${algo}.enc`);
    const moduleOutputFilePath = path.join(__dirname, 'tmp', `module-encrypted-${algo}.enc`);
    describe(`using ${algo} ${message}`, () => {
      it('should be able to decrypt a file encrypted with openssl', () => {
        return Promise.resolve()
          .then(() => encryptWithOpenSSL(inputFixturePath, opensslOutputFilePath, algo))
          .then(() => {
            const ss = secureStorage(opensslOutputFilePath, password, algo);
            let promise = Promise.resolve();
            Object.keys(inputFixture).forEach((service) => {
              Object.keys(inputFixture[service]).forEach((account) => {
                promise = promise
                  .then(() => ss.getPassword(service, account))
                  .then((retrievedPass) => {
                    expect(retrievedPass).toEqual(inputFixture[service][account]);
                  });
              });
            });
            return promise;
          });
      });

      it('should be able to encrypt data and output the same file as openssl', () => {
        const tempFile = path.join(__dirname, 'tmp', 'uglyinput.json');
        return Promise.resolve()
          .then(() => JSON.stringify(inputFixture, null, 2))
          .then((inputText) => fse.writeFileSync(tempFile, inputText))
          .then(() => encryptWithOpenSSL(tempFile, opensslOutputFilePath, algo))
          .then(() => {
            const ss = secureStorage(moduleOutputFilePath, password, algo);
            let promise = Promise.resolve();
            Object.keys(inputFixture).forEach((service) => {
              Object.keys(inputFixture[service]).forEach((account) => {
                promise = promise
                  .then(() => ss.setPassword(service, account, inputFixture[service][account]))
                  .then((success) => {
                    expect(success).toBeTrue();
                  });
              });
            });
            return promise;
          })
          .then(() => {
            return Promise.all([
              fse.readFileAsync(opensslOutputFilePath),
              fse.readFileAsync(moduleOutputFilePath)
            ]);
          })
          .then((values) => {
            const opensslContents = values[0].toString();
            const moduleContents = values[1].toString();
            return expect(moduleContents).toEqual(opensslContents);
          });
      });

      it('should be able to encrypt and then decrypt data and get the input as output', () => {
        return Promise.resolve()
          .then(() => encryptWithOpenSSL(inputFixturePath, opensslOutputFilePath, algo))
          .then(() => {
            const ss = secureStorage(moduleOutputFilePath, password, algo);
            let promise = Promise.resolve();
            Object.keys(inputFixture).forEach((service) => {
              Object.keys(inputFixture[service]).forEach((account) => {
                promise = promise
                  .then(() => ss.setPassword(service, account, inputFixture[service][account]))
                  .then((success) => {
                    expect(success).toBeTrue();
                  });
              });
            });
            return promise;
          })
          .then(() => {
            const ss = secureStorage(opensslOutputFilePath, password, algo);
            let promise = Promise.resolve();
            Object.keys(inputFixture).forEach((service) => {
              Object.keys(inputFixture[service]).forEach((account) => {
                promise = promise
                  .then(() => ss.getPassword(service, account))
                  .then((retrievedPass) => {
                    expect(retrievedPass).toEqual(inputFixture[service][account]);
                  });
              });
            });
            return promise;
          });
      });
    });
  });

  it('can sanely make multiple writes at the same time', () => {
    const filePath = path.join(__dirname, 'tmp', 'secure.enc');
    const algo = Object.keys(algos)[0];
    const ss = secureStorage(filePath, password, algo);
    return Promise.all([
      ss.setPassword('serv1', 'acct1', 'condo'),
      ss.setPassword('serv1', 'acct2', 'hondo'),
      ss.setPassword('serv2', 'acct1111', 'janefondo')
    ])
    .then(() =>
      ss.getPassword('serv1', 'acct1')
        .then((pass) => expect(pass).toEqual('condo'))
        .then(() => ss.getPassword('serv1', 'acct2'))
        .then((pass) => expect(pass).toEqual('hondo'))
        .then(() => ss.getPassword('serv2', 'acct1111'))
        .then((pass) => expect(pass).toEqual('janefondo'))
    );
  });

  it('can write to a file in a dir that doesn\'t exist', () => {
    const filePath = path.join(__dirname, 'tmp', 'frmp', 'brmp', 'secure.enc');
    const algo = Object.keys(algos)[0];
    const ss = secureStorage(filePath, password, algo);
    return ss.setPassword('a', 'b', 'c')
      .then((result) => {
        expect(result).toBeTrue();
        return ss.getPassword('a', 'b');
      })
      .then((pass) => {
        expect(pass).toEqual('c');
      });
  });

  it('can find a password', () => {
    const filePath = path.join(__dirname, 'tmp', 'secure.enc');
    const algo = Object.keys(algos)[0];
    const ss = secureStorage(filePath, password, algo);
    return Promise.all([
      ss.setPassword('serv1', 'acct1', 'condo'),
      ss.setPassword('serv1', 'acct2', 'hondo'),
      ss.setPassword('serv2', 'acct1111', 'janefondo')
    ])
    .then(() =>
      ss.findPassword('serv1')
        .then((pass) => expect(['condo', 'hondo'].includes(pass)).toEqual(true))
        .then(() => ss.findPassword('serv2'))
        .then((pass) => expect(['janefondo'].includes(pass)).toEqual(true))
    );
  });

  it('gets null when getting a non-existing password', () => {
    const filePath = path.join(__dirname, 'tmp', 'secure.enc');
    const algo = Object.keys(algos)[0];
    const ss = secureStorage(filePath, password, algo);
    return ss.getPassword('serv1', 'acct1')
      .then((pass) => expect(pass).toEqual(null));
  });

  it('gets null when finding a non-existing password', () => {
    const filePath = path.join(__dirname, 'tmp', 'secure.enc');
    const algo = Object.keys(algos)[0];
    const ss = secureStorage(filePath, password, algo);
    return ss.findPassword('serv1', 'acct1')
      .then((pass) => expect(pass).toEqual(null));
  });

  it('can replace an existing password', () => {
    const filePath = path.join(__dirname, 'tmp', 'secure.enc');
    const algo = Object.keys(algos)[0];
    const ss = secureStorage(filePath, password, algo);
    return ss.setPassword('serv1', 'acct1', 'condo')
      .then(() => ss.replacePassword('serv1', 'acct1', 'hondo'))
      .then(() => ss.getPassword('serv1', 'acct1'))
      .then((pass) => expect(pass).toEqual('hondo'));
  });

  it('can replace a non-existing password', () => {
    const filePath = path.join(__dirname, 'tmp', 'secure.enc');
    const algo = Object.keys(algos)[0];
    const ss = secureStorage(filePath, password, algo);
    return ss.setPassword('serv1', 'acct1', 'condo')
      .then(() => ss.replacePassword('serv1', 'acct2', 'hondo'))
      .then(() => ss.getPassword('serv1', 'acct1'))
      .then((pass) => expect(pass).toEqual('condo'))
      .then(() => ss.getPassword('serv1', 'acct2'))
      .then((pass) => expect(pass).toEqual('hondo'));
  });

  it('does not replace an existing password when using setPassword', () => {
    const filePath = path.join(__dirname, 'tmp', 'secure.enc');
    const algo = Object.keys(algos)[0];
    const ss = secureStorage(filePath, password, algo);
    return ss.setPassword('serv1', 'acct1', 'condo')
      .then(() => ss.setPassword('serv1', 'acct1', 'hondo'))
      .then(() => ss.getPassword('serv1', 'acct1'))
      .then((pass) => expect(pass).toEqual('condo'));
  });

  it('returns when getting a non existing password', () => {
    const filePath = path.join(__dirname, 'tmp', 'secure.enc');
    const algo = Object.keys(algos)[0];
    const ss = secureStorage(filePath, password, algo);
    return ss.setPassword('serv1', 'acct1', 'condo')
      .then(() => ss.getPassword('poyo', 'fundido'))
      .then((pass) => expect(pass).toEqual(null));
  });

  it('can delete a password', () => {
    const filePath = path.join(__dirname, 'tmp', 'secure.enc');
    const algo = Object.keys(algos)[0];
    const ss = secureStorage(filePath, password, algo);
    return ss.setPassword('serv1', 'acct1', 'condo')
      .then(() => ss.getPassword('serv1', 'acct1'))
      .then((pass) => expect(pass).toEqual('condo'))
      .then(() => ss.deletePassword('serv1', 'acct1'))
      .then((pass) => expect(pass).toEqual('condo'))
      .then(() => ss.getPassword('serv1', 'acct1'))
      .then((pass) => expect(pass).toEqual(null))
      .then(() => ss.deletePassword('serv2', 'cactusAccount'))
      .then((pass) => expect(pass).toEqual(false));
  });

  it('can properly guard', () => {
    const filePath = path.join(__dirname, 'tmp', 'secure.enc');
    const algo = Object.keys(algos)[0];
    const ss = secureStorage(filePath, password, algo);
    return ss.setPassword('serv1', 'acct1')
      .then((set) => expect(set).toEqual(false));
  });
});
