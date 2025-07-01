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
    expect(fs.existsSync(path.join(__dirname, '../dist/index.js'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '../dist/platform.js'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '../dist/platformAccessory.js'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '../dist/jobQueue.js'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '../dist/settings.js'))).toBe(true);
  });

  test('should verify package.json has required fields', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../package.json');

    expect(pkg.name).toBe('homebridge-echonet-lite-eolia');
    expect(pkg.version).toBe('1.0.0');
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
    const indexContent = fs.readFileSync(path.join(__dirname, '../dist/index.js'), 'utf8');
    expect(indexContent).toContain('PLATFORM_NAME');
    expect(indexContent).toContain('EoliaPlatform');
  });

  test('should have valid settings file', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');
    const settingsContent = fs.readFileSync(path.join(__dirname, '../dist/settings.js'), 'utf8');
    expect(settingsContent).toContain('EoliaPlatform');
    expect(settingsContent).toContain('homebridge-echonet-lite-eolia');
    expect(settingsContent).toContain('1.0.0');
  });
});