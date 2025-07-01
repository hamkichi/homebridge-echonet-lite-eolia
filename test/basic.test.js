// Simple JavaScript test to verify Jest works
describe('Basic Tests', () => {
  test('should perform basic arithmetic', () => {
    expect(2 + 2).toBe(4);
  });

  test('should handle async operations', async () => {
    const result = await Promise.resolve('test');
    expect(result).toBe('test');
  });

  test('should work with mock functions', () => {
    const mockFn = jest.fn();
    mockFn('hello');
    expect(mockFn).toHaveBeenCalledWith('hello');
  });

  test('should verify plugin structure exists', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');

    // Check that built files exist
    const distPath = path.join(__dirname, '../dist');
    expect(fs.existsSync(distPath)).toBe(true);
    expect(fs.existsSync(path.join(distPath, 'index.js'))).toBe(true);
    expect(fs.existsSync(path.join(distPath, 'platform.js'))).toBe(true);
    expect(fs.existsSync(path.join(distPath, 'platformAccessory.js'))).toBe(true);
    expect(fs.existsSync(path.join(distPath, 'jobQueue.js'))).toBe(true);
    expect(fs.existsSync(path.join(distPath, 'settings.js'))).toBe(true);
  });

  test('should verify package.json has required fields', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../package.json');

    expect(pkg.name).toBe('homebridge-echonet-lite-eolia');
    expect(pkg.version).toBe('0.9.1-beta.0');
    expect(pkg.main).toBe('dist/index.js');
    expect(pkg.engines).toBeDefined();
    expect(pkg.engines.node).toBeDefined();
    expect(pkg.engines.homebridge).toBeDefined();
  });

  test('should have valid plugin entry point', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');
    const indexPath = path.join(__dirname, '../dist/index.js');
    expect(fs.existsSync(indexPath)).toBe(true);
    const indexContent = fs.readFileSync(indexPath, 'utf8');
    expect(indexContent).toContain('PLATFORM_NAME');
    expect(indexContent).toContain('EoliaPlatform');
  });

  test('should have valid settings file', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');
    const settingsPath = path.join(__dirname, '../dist/settings.js');
    expect(fs.existsSync(settingsPath)).toBe(true);
    const settingsContent = fs.readFileSync(settingsPath, 'utf8');
    expect(settingsContent).toContain('EoliaPlatform');
    expect(settingsContent).toContain('homebridge-echonet-lite-eolia');
    expect(settingsContent).toContain('0.9.1-beta.0');
  });
});