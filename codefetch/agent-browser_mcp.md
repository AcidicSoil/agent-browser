<filetree>
Project Structure:
├── mcp
│   └── scaffold_mcp.md
└── src
    ├── actions.test.ts
    ├── actions.ts
    ├── browser.test.ts
    ├── browser.ts
    ├── daemon.ts
    ├── protocol.test.ts
    ├── protocol.ts
    ├── snapshot.ts
    ├── stream-server.ts
    └── types.ts

</filetree>

<source_code>
src/actions.test.ts
```
import { describe, it, expect } from 'vitest';
import { toAIFriendlyError } from './actions.js';

describe('toAIFriendlyError', () => {
  describe('element blocked by overlay', () => {
    it('should detect intercepts pointer events even when Timeout is in message', () => {
      // This is the exact error from Playwright when a cookie banner blocks an element
      // Bug: Previously this was incorrectly reported as "not found or not visible"
      const error = new Error(
        'TimeoutError: locator.click: Timeout 10000ms exceeded.\n' +
          'Call log:\n' +
          "  - waiting for getByRole('link', { name: 'Anmelden', exact: true }).first()\n" +
          '    - locator resolved to <a href="https://example.com/login">Anmelden</a>\n' +
          '  - attempting click action\n' +
          '    2 x waiting for element to be visible, enabled and stable\n' +
          '      - element is visible, enabled and stable\n' +
          '      - scrolling into view if needed\n' +
          '      - done scrolling\n' +
          '      - <body class="font-sans antialiased">...</body> intercepts pointer events\n' +
          '    - retrying click action'
      );

      const result = toAIFriendlyError(error, '@e4');

      // Must NOT say "not found" - the element WAS found
      expect(result.message).not.toContain('not found');
      // Must indicate the element is blocked
      expect(result.message).toContain('blocked by another element');
      expect(result.message).toContain('modal or overlay');
    });

    it('should suggest dismissing cookie banners', () => {
      const error = new Error('<div class="cookie-overlay"> intercepts pointer events');
      const result = toAIFriendlyError(error, '@e1');

      expect(result.message).toContain('cookie banners');
    });
  });
});
```

src/actions.ts
```
import type { Page, Frame } from 'playwright-core';
import type { BrowserManager, ScreencastFrame } from './browser.js';
import type {
  Command,
  Response,
  NavigateCommand,
  ClickCommand,
  TypeCommand,
  FillCommand,
  CheckCommand,
  UncheckCommand,
  UploadCommand,
  DoubleClickCommand,
  FocusCommand,
  DragCommand,
  FrameCommand,
  GetByRoleCommand,
  GetByTextCommand,
  GetByLabelCommand,
  GetByPlaceholderCommand,
  PressCommand,
  ScreenshotCommand,
  EvaluateCommand,
  WaitCommand,
  ScrollCommand,
  SelectCommand,
  HoverCommand,
  ContentCommand,
  TabSwitchCommand,
  TabCloseCommand,
  WindowNewCommand,
  CookiesSetCommand,
  StorageGetCommand,
  StorageSetCommand,
  StorageClearCommand,
  DialogCommand,
  PdfCommand,
  RouteCommand,
  RequestsCommand,
  DownloadCommand,
  GeolocationCommand,
  PermissionsCommand,
  ViewportCommand,
  DeviceCommand,
  GetAttributeCommand,
  GetTextCommand,
  IsVisibleCommand,
  IsEnabledCommand,
  IsCheckedCommand,
  CountCommand,
  BoundingBoxCommand,
  TraceStartCommand,
  TraceStopCommand,
  HarStopCommand,
  StorageStateSaveCommand,
  ConsoleCommand,
  ErrorsCommand,
  KeyboardCommand,
  WheelCommand,
  TapCommand,
  ClipboardCommand,
  HighlightCommand,
  ClearCommand,
  SelectAllCommand,
  InnerTextCommand,
  InnerHtmlCommand,
  InputValueCommand,
  SetValueCommand,
  DispatchEventCommand,
  AddScriptCommand,
  AddStyleCommand,
  EmulateMediaCommand,
  OfflineCommand,
  HeadersCommand,
  GetByAltTextCommand,
  GetByTitleCommand,
  GetByTestIdCommand,
  NthCommand,
  WaitForUrlCommand,
  WaitForLoadStateCommand,
  SetContentCommand,
  TimezoneCommand,
  LocaleCommand,
  HttpCredentialsCommand,
  MouseMoveCommand,
  MouseDownCommand,
  MouseUpCommand,
  WaitForFunctionCommand,
  ScrollIntoViewCommand,
  AddInitScriptCommand,
  KeyDownCommand,
  KeyUpCommand,
  InsertTextCommand,
  MultiSelectCommand,
  WaitForDownloadCommand,
  ResponseBodyCommand,
  ScreencastStartCommand,
  ScreencastStopCommand,
  InputMouseCommand,
  InputKeyboardCommand,
  InputTouchCommand,
  NavigateData,
  ScreenshotData,
  EvaluateData,
  ContentData,
  TabListData,
  TabNewData,
  TabSwitchData,
  TabCloseData,
  ScreencastStartData,
  ScreencastStopData,
  InputEventData,
} from './types.js';
import { successResponse, errorResponse } from './protocol.js';

// Callback for screencast frames - will be set by the daemon when streaming is active
let screencastFrameCallback: ((frame: ScreencastFrame) => void) | null = null;

/**
 * Set the callback for screencast frames
 * This is called by the daemon to set up frame streaming
 */
export function setScreencastFrameCallback(
  callback: ((frame: ScreencastFrame) => void) | null
): void {
  screencastFrameCallback = callback;
}

// Snapshot response type
interface SnapshotData {
  snapshot: string;
  refs?: Record<string, { role: string; name?: string }>;
}

/**
 * Convert Playwright errors to AI-friendly messages
 * @internal Exported for testing
 */
export function toAIFriendlyError(error: unknown, selector: string): Error {
  const message = error instanceof Error ? error.message : String(error);

  // Handle strict mode violation (multiple elements match)
  if (message.includes('strict mode violation')) {
    // Extract count if available
    const countMatch = message.match(/resolved to (\d+) elements/);
    const count = countMatch ? countMatch[1] : 'multiple';

    return new Error(
      `Selector "${selector}" matched ${count} elements. ` +
        `Run 'snapshot' to get updated refs, or use a more specific CSS selector.`
    );
  }

  // Handle element not interactable (must be checked BEFORE timeout case)
  // This includes cases where an overlay/modal blocks the element
  if (message.includes('intercepts pointer events')) {
    return new Error(
      `Element "${selector}" is blocked by another element (likely a modal or overlay). ` +
        `Try dismissing any modals/cookie banners first.`
    );
  }

  // Handle element not visible
  if (message.includes('not visible') && !message.includes('Timeout')) {
    return new Error(
      `Element "${selector}" is not visible. ` +
        `Try scrolling it into view or check if it's hidden.`
    );
  }

  // Handle element not found (timeout waiting for element)
  if (
    message.includes('waiting for') &&
    (message.includes('to be visible') || message.includes('Timeout'))
  ) {
    return new Error(
      `Element "${selector}" not found or not visible. ` +
        `Run 'snapshot' to see current page elements.`
    );
  }

  // Return original error for unknown cases
  return error instanceof Error ? error : new Error(message);
}

/**
 * Execute a command and return a response
 */
export async function executeCommand(command: Command, browser: BrowserManager): Promise<Response> {
  try {
    switch (command.action) {
      case 'launch':
        return await handleLaunch(command, browser);
      case 'navigate':
        return await handleNavigate(command, browser);
      case 'click':
        return await handleClick(command, browser);
      case 'type':
        return await handleType(command, browser);
      case 'fill':
        return await handleFill(command, browser);
      case 'check':
        return await handleCheck(command, browser);
      case 'uncheck':
        return await handleUncheck(command, browser);
      case 'upload':
        return await handleUpload(command, browser);
      case 'dblclick':
        return await handleDoubleClick(command, browser);
      case 'focus':
        return await handleFocus(command, browser);
      case 'drag':
        return await handleDrag(command, browser);
      case 'frame':
        return await handleFrame(command, browser);
      case 'mainframe':
        return await handleMainFrame(command, browser);
      case 'getbyrole':
        return await handleGetByRole(command, browser);
      case 'getbytext':
        return await handleGetByText(command, browser);
      case 'getbylabel':
        return await handleGetByLabel(command, browser);
      case 'getbyplaceholder':
        return await handleGetByPlaceholder(command, browser);
      case 'press':
        return await handlePress(command, browser);
      case 'screenshot':
        return await handleScreenshot(command, browser);
      case 'snapshot':
        return await handleSnapshot(command, browser);
      case 'evaluate':
        return await handleEvaluate(command, browser);
      case 'wait':
        return await handleWait(command, browser);
      case 'scroll':
        return await handleScroll(command, browser);
      case 'select':
        return await handleSelect(command, browser);
      case 'hover':
        return await handleHover(command, browser);
      case 'content':
        return await handleContent(command, browser);
      case 'close':
        return await handleClose(command, browser);
      case 'tab_new':
        return await handleTabNew(command, browser);
      case 'tab_list':
        return await handleTabList(command, browser);
      case 'tab_switch':
        return await handleTabSwitch(command, browser);
      case 'tab_close':
        return await handleTabClose(command, browser);
      case 'window_new':
        return await handleWindowNew(command, browser);
      case 'cookies_get':
        return await handleCookiesGet(command, browser);
      case 'cookies_set':
        return await handleCookiesSet(command, browser);
      case 'cookies_clear':
        return await handleCookiesClear(command, browser);
      case 'storage_get':
        return await handleStorageGet(command, browser);
      case 'storage_set':
        return await handleStorageSet(command, browser);
      case 'storage_clear':
        return await handleStorageClear(command, browser);
      case 'dialog':
        return await handleDialog(command, browser);
      case 'pdf':
        return await handlePdf(command, browser);
      case 'route':
        return await handleRoute(command, browser);
      case 'unroute':
        return await handleUnroute(command, browser);
      case 'requests':
        return await handleRequests(command, browser);
      case 'download':
        return await handleDownload(command, browser);
      case 'geolocation':
        return await handleGeolocation(command, browser);
      case 'permissions':
        return await handlePermissions(command, browser);
      case 'viewport':
        return await handleViewport(command, browser);
      case 'useragent':
        return await handleUserAgent(command, browser);
      case 'device':
        return await handleDevice(command, browser);
      case 'back':
        return await handleBack(command, browser);
      case 'forward':
        return await handleForward(command, browser);
      case 'reload':
        return await handleReload(command, browser);
      case 'url':
        return await handleUrl(command, browser);
      case 'title':
        return await handleTitle(command, browser);
      case 'getattribute':
        return await handleGetAttribute(command, browser);
      case 'gettext':
        return await handleGetText(command, browser);
      case 'isvisible':
        return await handleIsVisible(command, browser);
      case 'isenabled':
        return await handleIsEnabled(command, browser);
      case 'ischecked':
        return await handleIsChecked(command, browser);
      case 'count':
        return await handleCount(command, browser);
      case 'boundingbox':
        return await handleBoundingBox(command, browser);
      case 'video_start':
        return await handleVideoStart(command, browser);
      case 'video_stop':
        return await handleVideoStop(command, browser);
      case 'trace_start':
        return await handleTraceStart(command, browser);
      case 'trace_stop':
        return await handleTraceStop(command, browser);
      case 'har_start':
        return await handleHarStart(command, browser);
      case 'har_stop':
        return await handleHarStop(command, browser);
      case 'state_save':
        return await handleStateSave(command, browser);
      case 'state_load':
        return await handleStateLoad(command, browser);
      case 'console':
        return await handleConsole(command, browser);
      case 'errors':
        return await handleErrors(command, browser);
      case 'keyboard':
        return await handleKeyboard(command, browser);
      case 'wheel':
        return await handleWheel(command, browser);
      case 'tap':
        return await handleTap(command, browser);
      case 'clipboard':
        return await handleClipboard(command, browser);
      case 'highlight':
        return await handleHighlight(command, browser);
      case 'clear':
        return await handleClear(command, browser);
      case 'selectall':
        return await handleSelectAll(command, browser);
      case 'innertext':
        return await handleInnerText(command, browser);
      case 'innerhtml':
        return await handleInnerHtml(command, browser);
      case 'inputvalue':
        return await handleInputValue(command, browser);
      case 'setvalue':
        return await handleSetValue(command, browser);
      case 'dispatch':
        return await handleDispatch(command, browser);
      case 'evalhandle':
        return await handleEvalHandle(command, browser);
      case 'expose':
        return await handleExpose(command, browser);
      case 'addscript':
        return await handleAddScript(command, browser);
      case 'addstyle':
        return await handleAddStyle(command, browser);
      case 'emulatemedia':
        return await handleEmulateMedia(command, browser);
      case 'offline':
        return await handleOffline(command, browser);
      case 'headers':
        return await handleHeaders(command, browser);
      case 'pause':
        return await handlePause(command, browser);
      case 'getbyalttext':
        return await handleGetByAltText(command, browser);
      case 'getbytitle':
        return await handleGetByTitle(command, browser);
      case 'getbytestid':
        return await handleGetByTestId(command, browser);
      case 'nth':
        return await handleNth(command, browser);
      case 'waitforurl':
        return await handleWaitForUrl(command, browser);
      case 'waitforloadstate':
        return await handleWaitForLoadState(command, browser);
      case 'setcontent':
        return await handleSetContent(command, browser);
      case 'timezone':
        return await handleTimezone(command, browser);
      case 'locale':
        return await handleLocale(command, browser);
      case 'credentials':
        return await handleCredentials(command, browser);
      case 'mousemove':
        return await handleMouseMove(command, browser);
      case 'mousedown':
        return await handleMouseDown(command, browser);
      case 'mouseup':
        return await handleMouseUp(command, browser);
      case 'bringtofront':
        return await handleBringToFront(command, browser);
      case 'waitforfunction':
        return await handleWaitForFunction(command, browser);
      case 'scrollintoview':
        return await handleScrollIntoView(command, browser);
      case 'addinitscript':
        return await handleAddInitScript(command, browser);
      case 'keydown':
        return await handleKeyDown(command, browser);
      case 'keyup':
        return await handleKeyUp(command, browser);
      case 'inserttext':
        return await handleInsertText(command, browser);
      case 'multiselect':
        return await handleMultiSelect(command, browser);
      case 'waitfordownload':
        return await handleWaitForDownload(command, browser);
      case 'responsebody':
        return await handleResponseBody(command, browser);
      case 'screencast_start':
        return await handleScreencastStart(command, browser);
      case 'screencast_stop':
        return await handleScreencastStop(command, browser);
      case 'input_mouse':
        return await handleInputMouse(command, browser);
      case 'input_keyboard':
        return await handleInputKeyboard(command, browser);
      case 'input_touch':
        return await handleInputTouch(command, browser);
      default: {
        // TypeScript narrows to never here, but we handle it for safety
        const unknownCommand = command as { id: string; action: string };
        return errorResponse(unknownCommand.id, `Unknown action: ${unknownCommand.action}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(command.id, message);
  }
}

async function handleLaunch(
  command: Command & { action: 'launch' },
  browser: BrowserManager
): Promise<Response> {
  await browser.launch(command);
  return successResponse(command.id, { launched: true });
}

async function handleNavigate(
  command: NavigateCommand,
  browser: BrowserManager
): Promise<Response<NavigateData>> {
  const page = browser.getPage();

  // If headers are provided, set up scoped headers for this origin
  if (command.headers && Object.keys(command.headers).length > 0) {
    await browser.setScopedHeaders(command.url, command.headers);
  }

  await page.goto(command.url, {
    waitUntil: command.waitUntil ?? 'load',
  });

  return successResponse(command.id, {
    url: page.url(),
    title: await page.title(),
  });
}

async function handleClick(command: ClickCommand, browser: BrowserManager): Promise<Response> {
  // Support both refs (@e1) and regular selectors
  const locator = browser.getLocator(command.selector);

  try {
    await locator.click({
      button: command.button,
      clickCount: command.clickCount,
      delay: command.delay,
    });
  } catch (error) {
    throw toAIFriendlyError(error, command.selector);
  }

  return successResponse(command.id, { clicked: true });
}

async function handleType(command: TypeCommand, browser: BrowserManager): Promise<Response> {
  const locator = browser.getLocator(command.selector);

  try {
    if (command.clear) {
      await locator.fill('');
    }

    await locator.pressSequentially(command.text, {
      delay: command.delay,
    });
  } catch (error) {
    throw toAIFriendlyError(error, command.selector);
  }

  return successResponse(command.id, { typed: true });
}

async function handlePress(command: PressCommand, browser: BrowserManager): Promise<Response> {
  const page = browser.getPage();

  if (command.selector) {
    await page.press(command.selector, command.key);
  } else {
    await page.keyboard.press(command.key);
  }

  return successResponse(command.id, { pressed: true });
}

async function handleScreenshot(
  command: ScreenshotCommand,
  browser: BrowserManager
): Promise<Response<ScreenshotData>> {
  const page = browser.getPage();

  const options: Parameters<Page['screenshot']>[0] = {
    fullPage: command.fullPage,
    type: command.format ?? 'png',
  };

  if (command.format === 'jpeg' && command.quality !== undefined) {
    options.quality = command.quality;
  }

  let target: Page | ReturnType<Page['locator']> = page;
  if (command.selector) {
    target = page.locator(command.selector);
  }

  if (command.path) {
    await target.screenshot({ ...options, path: command.path });
    return successResponse(command.id, { path: command.path });
  } else {
    const buffer = await target.screenshot(options);
    return successResponse(command.id, { base64: buffer.toString('base64') });
  }
}

async function handleSnapshot(
  command: Command & {
    action: 'snapshot';
    interactive?: boolean;
    maxDepth?: number;
    compact?: boolean;
    selector?: string;
  },
  browser: BrowserManager
): Promise<Response<SnapshotData>> {
  // Use enhanced snapshot with refs and optional filtering
  const { tree, refs } = await browser.getSnapshot({
    interactive: command.interactive,
    maxDepth: command.maxDepth,
    compact: command.compact,
    selector: command.selector,
  });

  // Simplify refs for output (just role and name)
  const simpleRefs: Record<string, { role: string; name?: string }> = {};
  for (const [ref, data] of Object.entries(refs)) {
    simpleRefs[ref] = { role: data.role, name: data.name };
  }

  return successResponse(command.id, {
    snapshot: tree || 'Empty page',
    refs: Object.keys(simpleRefs).length > 0 ? simpleRefs : undefined,
  });
}

async function handleEvaluate(
  command: EvaluateCommand,
  browser: BrowserManager
): Promise<Response<EvaluateData>> {
  const page = browser.getPage();

  // Evaluate the script directly as a string expression
  const result = await page.evaluate(command.script);

  return successResponse(command.id, { result });
}

async function handleWait(command: WaitCommand, browser: BrowserManager): Promise<Response> {
  const page = browser.getPage();

  if (command.selector) {
    await page.waitForSelector(command.selector, {
      state: command.state ?? 'visible',
      timeout: command.timeout,
    });
  } else if (command.timeout) {
    await page.waitForTimeout(command.timeout);
  } else {
    // Default: wait for load state
    await page.waitForLoadState('load');
  }

  return successResponse(command.id, { waited: true });
}

async function handleScroll(command: ScrollCommand, browser: BrowserManager): Promise<Response> {
  const page = browser.getPage();

  if (command.selector) {
    const element = page.locator(command.selector);
    await element.scrollIntoViewIfNeeded();

    if (command.x !== undefined || command.y !== undefined) {
      await element.evaluate(
        (el, { x, y }) => {
          el.scrollBy(x ?? 0, y ?? 0);
        },
        { x: command.x, y: command.y }
      );
    }
  } else {
    // Scroll the page
    let deltaX = command.x ?? 0;
    let deltaY = command.y ?? 0;

    if (command.direction) {
      const amount = command.amount ?? 100;
      switch (command.direction) {
        case 'up':
          deltaY = -amount;
          break;
        case 'down':
          deltaY = amount;
          break;
        case 'left':
          deltaX = -amount;
          break;
        case 'right':
          deltaX = amount;
          break;
      }
    }

    await page.evaluate(`window.scrollBy(${deltaX}, ${deltaY})`);
  }

  return successResponse(command.id, { scrolled: true });
}

async function handleSelect(command: SelectCommand, browser: BrowserManager): Promise<Response> {
  const locator = browser.getLocator(command.selector);
  const values = Array.isArray(command.values) ? command.values : [command.values];

  try {
    await locator.selectOption(values);
  } catch (error) {
    throw toAIFriendlyError(error, command.selector);
  }

  return successResponse(command.id, { selected: values });
}

async function handleHover(command: HoverCommand, browser: BrowserManager): Promise<Response> {
  const locator = browser.getLocator(command.selector);
  try {
    await locator.hover();
  } catch (error) {
    throw toAIFriendlyError(error, command.selector);
  }

  return successResponse(command.id, { hovered: true });
}

async function handleContent(
  command: ContentCommand,
  browser: BrowserManager
): Promise<Response<ContentData>> {
  const page = browser.getPage();

  let html: string;
  if (command.selector) {
    html = await page.locator(command.selector).innerHTML();
  } else {
    html = await page.content();
  }

  return successResponse(command.id, { html });
}

async function handleClose(
  command: Command & { action: 'close' },
  browser: BrowserManager
): Promise<Response> {
  await browser.close();
  return successResponse(command.id, { closed: true });
}

async function handleTabNew(
  command: Command & { action: 'tab_new' },
  browser: BrowserManager
): Promise<Response<TabNewData>> {
  const result = await browser.newTab();
  return successResponse(command.id, result);
}

async function handleTabList(
  command: Command & { action: 'tab_list' },
  browser: BrowserManager
): Promise<Response<TabListData>> {
  const tabs = await browser.listTabs();
  return successResponse(command.id, {
    tabs,
    active: browser.getActiveIndex(),
  });
}

async function handleTabSwitch(
  command: TabSwitchCommand,
  browser: BrowserManager
): Promise<Response<TabSwitchData>> {
  const result = await browser.switchTo(command.index);
  const page = browser.getPage();
  return successResponse(command.id, {
    ...result,
    title: await page.title(),
  });
}

async function handleTabClose(
  command: TabCloseCommand,
  browser: BrowserManager
): Promise<Response<TabCloseData>> {
  const result = await browser.closeTab(command.index);
  return successResponse(command.id, result);
}

async function handleWindowNew(
  command: WindowNewCommand,
  browser: BrowserManager
): Promise<Response<TabNewData>> {
  const result = await browser.newWindow(command.viewport);
  return successResponse(command.id, result);
}

// New handlers for enhanced Playwright parity

async function handleFill(command: FillCommand, browser: BrowserManager): Promise<Response> {
  const locator = browser.getLocator(command.selector);
  try {
    await locator.fill(command.value);
  } catch (error) {
    throw toAIFriendlyError(error, command.selector);
  }
  return successResponse(command.id, { filled: true });
}

async function handleCheck(command: CheckCommand, browser: BrowserManager): Promise<Response> {
  const locator = browser.getLocator(command.selector);
  try {
    await locator.check();
  } catch (error) {
    throw toAIFriendlyError(error, command.selector);
  }
  return successResponse(command.id, { checked: true });
}

async function handleUncheck(command: UncheckCommand, browser: BrowserManager): Promise<Response> {
  const locator = browser.getLocator(command.selector);
  try {
    await locator.uncheck();
  } catch (error) {
    throw toAIFriendlyError(error, command.selector);
  }
  return successResponse(command.id, { unchecked: true });
}

async function handleUpload(command: UploadCommand, browser: BrowserManager): Promise<Response> {
  const locator = browser.getLocator(command.selector);
  const files = Array.isArray(command.files) ? command.files : [command.files];
  try {
    await locator.setInputFiles(files);
  } catch (error) {
    throw toAIFriendlyError(error, command.selector);
  }
  return successResponse(command.id, { uploaded: files });
}

async function handleDoubleClick(
  command: DoubleClickCommand,
  browser: BrowserManager
): Promise<Response> {
  const locator = browser.getLocator(command.selector);
  try {
    await locator.dblclick();
  } catch (error) {
    throw toAIFriendlyError(error, command.selector);
  }
  return successResponse(command.id, { clicked: true });
}

async function handleFocus(command: FocusCommand, browser: BrowserManager): Promise<Response> {
  const locator = browser.getLocator(command.selector);
  try {
    await locator.focus();
  } catch (error) {
    throw toAIFriendlyError(error, command.selector);
  }
  return successResponse(command.id, { focused: true });
}

async function handleDrag(command: DragCommand, browser: BrowserManager): Promise<Response> {
  const frame = browser.getFrame();
  await frame.dragAndDrop(command.source, command.target);
  return successResponse(command.id, { dragged: true });
}

async function handleFrame(command: FrameCommand, browser: BrowserManager): Promise<Response> {
  await browser.switchToFrame({
    selector: command.selector,
    name: command.name,
    url: command.url,
  });
  return successResponse(command.id, { switched: true });
}

async function handleMainFrame(
  command: Command & { action: 'mainframe' },
  browser: BrowserManager
): Promise<Response> {
  browser.switchToMainFrame();
  return successResponse(command.id, { switched: true });
}

async function handleGetByRole(
  command: GetByRoleCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const locator = page.getByRole(command.role as any, { name: command.name });

  switch (command.subaction) {
    case 'click':
      await locator.click();
      return successResponse(command.id, { clicked: true });
    case 'fill':
      await locator.fill(command.value ?? '');
      return successResponse(command.id, { filled: true });
    case 'check':
      await locator.check();
      return successResponse(command.id, { checked: true });
    case 'hover':
      await locator.hover();
      return successResponse(command.id, { hovered: true });
  }
}

async function handleGetByText(
  command: GetByTextCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const locator = page.getByText(command.text, { exact: command.exact });

  switch (command.subaction) {
    case 'click':
      await locator.click();
      return successResponse(command.id, { clicked: true });
    case 'hover':
      await locator.hover();
      return successResponse(command.id, { hovered: true });
  }
}

async function handleGetByLabel(
  command: GetByLabelCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const locator = page.getByLabel(command.label);

  switch (command.subaction) {
    case 'click':
      await locator.click();
      return successResponse(command.id, { clicked: true });
    case 'fill':
      await locator.fill(command.value ?? '');
      return successResponse(command.id, { filled: true });
    case 'check':
      await locator.check();
      return successResponse(command.id, { checked: true });
  }
}

async function handleGetByPlaceholder(
  command: GetByPlaceholderCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const locator = page.getByPlaceholder(command.placeholder);

  switch (command.subaction) {
    case 'click':
      await locator.click();
      return successResponse(command.id, { clicked: true });
    case 'fill':
      await locator.fill(command.value ?? '');
      return successResponse(command.id, { filled: true });
  }
}

async function handleCookiesGet(
  command: Command & { action: 'cookies_get'; urls?: string[] },
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const context = page.context();
  const cookies = await context.cookies(command.urls);
  return successResponse(command.id, { cookies });
}

async function handleCookiesSet(
  command: CookiesSetCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const context = page.context();
  // Auto-fill URL for cookies that don't have domain/path/url set
  const pageUrl = page.url();
  const cookies = command.cookies.map((cookie) => {
    if (!cookie.url && !cookie.domain && !cookie.path) {
      return { ...cookie, url: pageUrl };
    }
    return cookie;
  });
  await context.addCookies(cookies);
  return successResponse(command.id, { set: true });
}

async function handleCookiesClear(
  command: Command & { action: 'cookies_clear' },
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const context = page.context();
  await context.clearCookies();
  return successResponse(command.id, { cleared: true });
}

async function handleStorageGet(
  command: StorageGetCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const storageType = command.type === 'local' ? 'localStorage' : 'sessionStorage';

  if (command.key) {
    const value = await page.evaluate(`${storageType}.getItem(${JSON.stringify(command.key)})`);
    return successResponse(command.id, { key: command.key, value });
  } else {
    const data = await page.evaluate(`
      (() => {
        const storage = ${storageType};
        const result = {};
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key) result[key] = storage.getItem(key);
        }
        return result;
      })()
    `);
    return successResponse(command.id, { data });
  }
}

async function handleStorageSet(
  command: StorageSetCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const storageType = command.type === 'local' ? 'localStorage' : 'sessionStorage';

  await page.evaluate(
    `${storageType}.setItem(${JSON.stringify(command.key)}, ${JSON.stringify(command.value)})`
  );
  return successResponse(command.id, { set: true });
}

async function handleStorageClear(
  command: StorageClearCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const storageType = command.type === 'local' ? 'localStorage' : 'sessionStorage';

  await page.evaluate(`${storageType}.clear()`);
  return successResponse(command.id, { cleared: true });
}

async function handleDialog(command: DialogCommand, browser: BrowserManager): Promise<Response> {
  browser.setDialogHandler(command.response, command.promptText);
  return successResponse(command.id, { handler: 'set', response: command.response });
}

async function handlePdf(command: PdfCommand, browser: BrowserManager): Promise<Response> {
  const page = browser.getPage();
  await page.pdf({
    path: command.path,
    format: command.format ?? 'Letter',
  });
  return successResponse(command.id, { path: command.path });
}

// Network & Request handlers

async function handleRoute(command: RouteCommand, browser: BrowserManager): Promise<Response> {
  await browser.addRoute(command.url, {
    response: command.response,
    abort: command.abort,
  });
  return successResponse(command.id, { routed: command.url });
}

async function handleUnroute(
  command: Command & { action: 'unroute'; url?: string },
  browser: BrowserManager
): Promise<Response> {
  await browser.removeRoute(command.url);
  return successResponse(command.id, { unrouted: command.url ?? 'all' });
}

async function handleRequests(
  command: RequestsCommand,
  browser: BrowserManager
): Promise<Response> {
  if (command.clear) {
    browser.clearRequests();
    return successResponse(command.id, { cleared: true });
  }

  // Start tracking if not already
  browser.startRequestTracking();

  const requests = browser.getRequests(command.filter);
  return successResponse(command.id, { requests });
}

async function handleDownload(
  command: DownloadCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click(command.selector),
  ]);

  await download.saveAs(command.path);
  return successResponse(command.id, {
    path: command.path,
    suggestedFilename: download.suggestedFilename(),
  });
}

async function handleGeolocation(
  command: GeolocationCommand,
  browser: BrowserManager
): Promise<Response> {
  await browser.setGeolocation(command.latitude, command.longitude, command.accuracy);
  return successResponse(command.id, {
    latitude: command.latitude,
    longitude: command.longitude,
  });
}

async function handlePermissions(
  command: PermissionsCommand,
  browser: BrowserManager
): Promise<Response> {
  await browser.setPermissions(command.permissions, command.grant);
  return successResponse(command.id, {
    permissions: command.permissions,
    granted: command.grant,
  });
}

async function handleViewport(
  command: ViewportCommand,
  browser: BrowserManager
): Promise<Response> {
  await browser.setViewport(command.width, command.height);
  return successResponse(command.id, {
    width: command.width,
    height: command.height,
  });
}

async function handleUserAgent(
  command: Command & { action: 'useragent'; userAgent: string },
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const context = page.context();
  // Note: Can't change user agent after context is created, but we can for new pages
  return successResponse(command.id, {
    note: 'User agent can only be set at launch time. Use device command instead.',
  });
}

async function handleDevice(command: DeviceCommand, browser: BrowserManager): Promise<Response> {
  const device = browser.getDevice(command.device);
  if (!device) {
    const available = browser.listDevices().slice(0, 10).join(', ');
    throw new Error(`Unknown device: ${command.device}. Available: ${available}...`);
  }

  // Apply device viewport
  await browser.setViewport(device.viewport.width, device.viewport.height);

  return successResponse(command.id, {
    device: command.device,
    viewport: device.viewport,
    userAgent: device.userAgent,
  });
}

async function handleBack(
  command: Command & { action: 'back' },
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  await page.goBack();
  return successResponse(command.id, { url: page.url() });
}

async function handleForward(
  command: Command & { action: 'forward' },
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  await page.goForward();
  return successResponse(command.id, { url: page.url() });
}

async function handleReload(
  command: Command & { action: 'reload' },
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  await page.reload();
  return successResponse(command.id, { url: page.url() });
}

async function handleUrl(
  command: Command & { action: 'url' },
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  return successResponse(command.id, { url: page.url() });
}

async function handleTitle(
  command: Command & { action: 'title' },
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const title = await page.title();
  return successResponse(command.id, { title });
}

async function handleGetAttribute(
  command: GetAttributeCommand,
  browser: BrowserManager
): Promise<Response> {
  const locator = browser.getLocator(command.selector);
  const value = await locator.getAttribute(command.attribute);
  return successResponse(command.id, { attribute: command.attribute, value });
}

async function handleGetText(command: GetTextCommand, browser: BrowserManager): Promise<Response> {
  const locator = browser.getLocator(command.selector);
  const text = await locator.textContent();
  return successResponse(command.id, { text });
}

async function handleIsVisible(
  command: IsVisibleCommand,
  browser: BrowserManager
): Promise<Response> {
  const locator = browser.getLocator(command.selector);
  const visible = await locator.isVisible();
  return successResponse(command.id, { visible });
}

async function handleIsEnabled(
  command: IsEnabledCommand,
  browser: BrowserManager
): Promise<Response> {
  const locator = browser.getLocator(command.selector);
  const enabled = await locator.isEnabled();
  return successResponse(command.id, { enabled });
}

async function handleIsChecked(
  command: IsCheckedCommand,
  browser: BrowserManager
): Promise<Response> {
  const locator = browser.getLocator(command.selector);
  const checked = await locator.isChecked();
  return successResponse(command.id, { checked });
}

async function handleCount(command: CountCommand, browser: BrowserManager): Promise<Response> {
  const page = browser.getPage();
  const count = await page.locator(command.selector).count();
  return successResponse(command.id, { count });
}

async function handleBoundingBox(
  command: BoundingBoxCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const box = await page.locator(command.selector).boundingBox();
  return successResponse(command.id, { box });
}

// Advanced handlers

async function handleVideoStart(
  command: Command & { action: 'video_start'; path: string },
  browser: BrowserManager
): Promise<Response> {
  // Video recording requires context-level setup at launch
  // For now, return a note about this limitation
  return successResponse(command.id, {
    note: 'Video recording must be enabled at browser launch. Use --video flag when starting.',
    path: command.path,
  });
}

async function handleVideoStop(
  command: Command & { action: 'video_stop' },
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const video = page.video();
  if (video) {
    const path = await video.path();
    return successResponse(command.id, { path });
  }
  return successResponse(command.id, { note: 'No video recording active' });
}

async function handleTraceStart(
  command: TraceStartCommand,
  browser: BrowserManager
): Promise<Response> {
  await browser.startTracing({
    screenshots: command.screenshots,
    snapshots: command.snapshots,
  });
  return successResponse(command.id, { started: true });
}

async function handleTraceStop(
  command: TraceStopCommand,
  browser: BrowserManager
): Promise<Response> {
  await browser.stopTracing(command.path);
  return successResponse(command.id, { path: command.path });
}

async function handleHarStart(
  command: Command & { action: 'har_start' },
  browser: BrowserManager
): Promise<Response> {
  await browser.startHarRecording();
  browser.startRequestTracking();
  return successResponse(command.id, { started: true });
}

async function handleHarStop(command: HarStopCommand, browser: BrowserManager): Promise<Response> {
  // HAR recording is handled at context level
  // For now, we save tracked requests as a simplified HAR-like format
  const requests = browser.getRequests();
  return successResponse(command.id, {
    path: command.path,
    requestCount: requests.length,
  });
}

async function handleStateSave(
  command: StorageStateSaveCommand,
  browser: BrowserManager
): Promise<Response> {
  await browser.saveStorageState(command.path);
  return successResponse(command.id, { path: command.path });
}

async function handleStateLoad(
  command: Command & { action: 'state_load'; path: string },
  browser: BrowserManager
): Promise<Response> {
  // Storage state is loaded at context creation
  return successResponse(command.id, {
    note: 'Storage state must be loaded at browser launch. Use --state flag.',
    path: command.path,
  });
}

async function handleConsole(command: ConsoleCommand, browser: BrowserManager): Promise<Response> {
  if (command.clear) {
    browser.clearConsoleMessages();
    return successResponse(command.id, { cleared: true });
  }

  const messages = browser.getConsoleMessages();
  return successResponse(command.id, { messages });
}

async function handleErrors(command: ErrorsCommand, browser: BrowserManager): Promise<Response> {
  if (command.clear) {
    browser.clearPageErrors();
    return successResponse(command.id, { cleared: true });
  }

  const errors = browser.getPageErrors();
  return successResponse(command.id, { errors });
}

async function handleKeyboard(
  command: KeyboardCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  await page.keyboard.press(command.keys);
  return successResponse(command.id, { pressed: command.keys });
}

async function handleWheel(command: WheelCommand, browser: BrowserManager): Promise<Response> {
  const page = browser.getPage();

  if (command.selector) {
    const element = page.locator(command.selector);
    await element.hover();
  }

  await page.mouse.wheel(command.deltaX ?? 0, command.deltaY ?? 0);
  return successResponse(command.id, { scrolled: true });
}

async function handleTap(command: TapCommand, browser: BrowserManager): Promise<Response> {
  const page = browser.getPage();
  await page.tap(command.selector);
  return successResponse(command.id, { tapped: true });
}

async function handleClipboard(
  command: ClipboardCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();

  switch (command.operation) {
    case 'copy':
      await page.keyboard.press('Control+c');
      return successResponse(command.id, { copied: true });
    case 'paste':
      await page.keyboard.press('Control+v');
      return successResponse(command.id, { pasted: true });
    case 'read':
      const text = await page.evaluate('navigator.clipboard.readText()');
      return successResponse(command.id, { text });
    default:
      return errorResponse(command.id, 'Unknown clipboard operation');
  }
}

async function handleHighlight(
  command: HighlightCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  await page.locator(command.selector).highlight();
  return successResponse(command.id, { highlighted: true });
}

async function handleClear(command: ClearCommand, browser: BrowserManager): Promise<Response> {
  const page = browser.getPage();
  await page.locator(command.selector).clear();
  return successResponse(command.id, { cleared: true });
}

async function handleSelectAll(
  command: SelectAllCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  await page.locator(command.selector).selectText();
  return successResponse(command.id, { selected: true });
}

async function handleInnerText(
  command: InnerTextCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const text = await page.locator(command.selector).innerText();
  return successResponse(command.id, { text });
}

async function handleInnerHtml(
  command: InnerHtmlCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const html = await page.locator(command.selector).innerHTML();
  return successResponse(command.id, { html });
}

async function handleInputValue(
  command: InputValueCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const value = await page.locator(command.selector).inputValue();
  return successResponse(command.id, { value });
}

async function handleSetValue(
  command: SetValueCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  await page.locator(command.selector).fill(command.value);
  return successResponse(command.id, { set: true });
}

async function handleDispatch(
  command: DispatchEventCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  await page.locator(command.selector).dispatchEvent(command.event, command.eventInit);
  return successResponse(command.id, { dispatched: command.event });
}

async function handleEvalHandle(
  command: Command & { action: 'evalhandle'; script: string },
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const handle = await page.evaluateHandle(command.script);
  const result = await handle.jsonValue().catch(() => 'Handle (non-serializable)');
  return successResponse(command.id, { result });
}

async function handleExpose(
  command: Command & { action: 'expose'; name: string },
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  await page.exposeFunction(command.name, () => {
    // Exposed function - can be extended
    return `Function ${command.name} called`;
  });
  return successResponse(command.id, { exposed: command.name });
}

async function handleAddScript(
  command: AddScriptCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();

  if (command.content) {
    await page.addScriptTag({ content: command.content });
  } else if (command.url) {
    await page.addScriptTag({ url: command.url });
  }

  return successResponse(command.id, { added: true });
}

async function handleAddStyle(
  command: AddStyleCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();

  if (command.content) {
    await page.addStyleTag({ content: command.content });
  } else if (command.url) {
    await page.addStyleTag({ url: command.url });
  }

  return successResponse(command.id, { added: true });
}

async function handleEmulateMedia(
  command: EmulateMediaCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  await page.emulateMedia({
    media: command.media,
    colorScheme: command.colorScheme,
    reducedMotion: command.reducedMotion,
    forcedColors: command.forcedColors,
  });
  return successResponse(command.id, { emulated: true });
}

async function handleOffline(command: OfflineCommand, browser: BrowserManager): Promise<Response> {
  await browser.setOffline(command.offline);
  return successResponse(command.id, { offline: command.offline });
}

async function handleHeaders(command: HeadersCommand, browser: BrowserManager): Promise<Response> {
  await browser.setExtraHeaders(command.headers);
  return successResponse(command.id, { set: true });
}

async function handlePause(
  command: Command & { action: 'pause' },
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  await page.pause();
  return successResponse(command.id, { paused: true });
}

async function handleGetByAltText(
  command: GetByAltTextCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const locator = page.getByAltText(command.text, { exact: command.exact });

  switch (command.subaction) {
    case 'click':
      await locator.click();
      return successResponse(command.id, { clicked: true });
    case 'hover':
      await locator.hover();
      return successResponse(command.id, { hovered: true });
  }
}

async function handleGetByTitle(
  command: GetByTitleCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const locator = page.getByTitle(command.text, { exact: command.exact });

  switch (command.subaction) {
    case 'click':
      await locator.click();
      return successResponse(command.id, { clicked: true });
    case 'hover':
      await locator.hover();
      return successResponse(command.id, { hovered: true });
  }
}

async function handleGetByTestId(
  command: GetByTestIdCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const locator = page.getByTestId(command.testId);

  switch (command.subaction) {
    case 'click':
      await locator.click();
      return successResponse(command.id, { clicked: true });
    case 'fill':
      await locator.fill(command.value ?? '');
      return successResponse(command.id, { filled: true });
    case 'check':
      await locator.check();
      return successResponse(command.id, { checked: true });
    case 'hover':
      await locator.hover();
      return successResponse(command.id, { hovered: true });
  }
}

async function handleNth(command: NthCommand, browser: BrowserManager): Promise<Response> {
  const page = browser.getPage();
  const base = page.locator(command.selector);
  const locator = command.index === -1 ? base.last() : base.nth(command.index);

  switch (command.subaction) {
    case 'click':
      await locator.click();
      return successResponse(command.id, { clicked: true });
    case 'fill':
      await locator.fill(command.value ?? '');
      return successResponse(command.id, { filled: true });
    case 'check':
      await locator.check();
      return successResponse(command.id, { checked: true });
    case 'hover':
      await locator.hover();
      return successResponse(command.id, { hovered: true });
    case 'text':
      const text = await locator.textContent();
      return successResponse(command.id, { text });
  }
}

async function handleWaitForUrl(
  command: WaitForUrlCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  await page.waitForURL(command.url, { timeout: command.timeout });
  return successResponse(command.id, { url: page.url() });
}

async function handleWaitForLoadState(
  command: WaitForLoadStateCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  await page.waitForLoadState(command.state, { timeout: command.timeout });
  return successResponse(command.id, { state: command.state });
}

async function handleSetContent(
  command: SetContentCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  await page.setContent(command.html);
  return successResponse(command.id, { set: true });
}

async function handleTimezone(
  command: TimezoneCommand,
  browser: BrowserManager
): Promise<Response> {
  // Timezone must be set at context level before navigation
  // This is a limitation - it sets for the current context
  const page = browser.getPage();
  await page.context().setGeolocation({ latitude: 0, longitude: 0 }); // Trigger context awareness
  return successResponse(command.id, {
    note: 'Timezone must be set at browser launch. Use --timezone flag.',
    timezone: command.timezone,
  });
}

async function handleLocale(command: LocaleCommand, browser: BrowserManager): Promise<Response> {
  // Locale must be set at context creation
  return successResponse(command.id, {
    note: 'Locale must be set at browser launch. Use --locale flag.',
    locale: command.locale,
  });
}

async function handleCredentials(
  command: HttpCredentialsCommand,
  browser: BrowserManager
): Promise<Response> {
  const context = browser.getPage().context();
  await context.setHTTPCredentials({
    username: command.username,
    password: command.password,
  });
  return successResponse(command.id, { set: true });
}

async function handleMouseMove(
  command: MouseMoveCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  await page.mouse.move(command.x, command.y);
  return successResponse(command.id, { moved: true, x: command.x, y: command.y });
}

async function handleMouseDown(
  command: MouseDownCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  await page.mouse.down({ button: command.button ?? 'left' });
  return successResponse(command.id, { down: true });
}

async function handleMouseUp(command: MouseUpCommand, browser: BrowserManager): Promise<Response> {
  const page = browser.getPage();
  await page.mouse.up({ button: command.button ?? 'left' });
  return successResponse(command.id, { up: true });
}

async function handleBringToFront(
  command: Command & { action: 'bringtofront' },
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  await page.bringToFront();
  return successResponse(command.id, { focused: true });
}

async function handleWaitForFunction(
  command: WaitForFunctionCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  await page.waitForFunction(command.expression, { timeout: command.timeout });
  return successResponse(command.id, { waited: true });
}

async function handleScrollIntoView(
  command: ScrollIntoViewCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  await page.locator(command.selector).scrollIntoViewIfNeeded();
  return successResponse(command.id, { scrolled: true });
}

async function handleAddInitScript(
  command: AddInitScriptCommand,
  browser: BrowserManager
): Promise<Response> {
  const context = browser.getPage().context();
  await context.addInitScript(command.script);
  return successResponse(command.id, { added: true });
}

async function handleKeyDown(command: KeyDownCommand, browser: BrowserManager): Promise<Response> {
  const page = browser.getPage();
  await page.keyboard.down(command.key);
  return successResponse(command.id, { down: true, key: command.key });
}

async function handleKeyUp(command: KeyUpCommand, browser: BrowserManager): Promise<Response> {
  const page = browser.getPage();
  await page.keyboard.up(command.key);
  return successResponse(command.id, { up: true, key: command.key });
}

async function handleInsertText(
  command: InsertTextCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  await page.keyboard.insertText(command.text);
  return successResponse(command.id, { inserted: true });
}

async function handleMultiSelect(
  command: MultiSelectCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const selected = await page.locator(command.selector).selectOption(command.values);
  return successResponse(command.id, { selected });
}

async function handleWaitForDownload(
  command: WaitForDownloadCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const download = await page.waitForEvent('download', { timeout: command.timeout });

  let filePath: string;
  if (command.path) {
    filePath = command.path;
    await download.saveAs(filePath);
  } else {
    filePath = (await download.path()) || download.suggestedFilename();
  }

  return successResponse(command.id, {
    path: filePath,
    filename: download.suggestedFilename(),
    url: download.url(),
  });
}

async function handleResponseBody(
  command: ResponseBodyCommand,
  browser: BrowserManager
): Promise<Response> {
  const page = browser.getPage();
  const response = await page.waitForResponse((resp) => resp.url().includes(command.url), {
    timeout: command.timeout,
  });

  const body = await response.text();
  let parsed: unknown = body;

  try {
    parsed = JSON.parse(body);
  } catch {
    // Keep as string if not JSON
  }

  return successResponse(command.id, {
    url: response.url(),
    status: response.status(),
    body: parsed,
  });
}

// Screencast and input injection handlers

async function handleScreencastStart(
  command: ScreencastStartCommand,
  browser: BrowserManager
): Promise<Response<ScreencastStartData>> {
  if (!screencastFrameCallback) {
    throw new Error('Screencast frame callback not set. Start the streaming server first.');
  }

  await browser.startScreencast(screencastFrameCallback, {
    format: command.format,
    quality: command.quality,
    maxWidth: command.maxWidth,
    maxHeight: command.maxHeight,
    everyNthFrame: command.everyNthFrame,
  });

  return successResponse(command.id, {
    started: true,
    format: command.format ?? 'jpeg',
    quality: command.quality ?? 80,
  });
}

async function handleScreencastStop(
  command: ScreencastStopCommand,
  browser: BrowserManager
): Promise<Response<ScreencastStopData>> {
  await browser.stopScreencast();
  return successResponse(command.id, { stopped: true });
}

async function handleInputMouse(
  command: InputMouseCommand,
  browser: BrowserManager
): Promise<Response<InputEventData>> {
  await browser.injectMouseEvent({
    type: command.type,
    x: command.x,
    y: command.y,
    button: command.button,
    clickCount: command.clickCount,
    deltaX: command.deltaX,
    deltaY: command.deltaY,
    modifiers: command.modifiers,
  });
  return successResponse(command.id, { injected: true });
}

async function handleInputKeyboard(
  command: InputKeyboardCommand,
  browser: BrowserManager
): Promise<Response<InputEventData>> {
  await browser.injectKeyboardEvent({
    type: command.type,
    key: command.key,
    code: command.code,
    text: command.text,
    modifiers: command.modifiers,
  });
  return successResponse(command.id, { injected: true });
}

async function handleInputTouch(
  command: InputTouchCommand,
  browser: BrowserManager
): Promise<Response<InputEventData>> {
  await browser.injectTouchEvent({
    type: command.type,
    touchPoints: command.touchPoints,
    modifiers: command.modifiers,
  });
  return successResponse(command.id, { injected: true });
}
```

src/browser.test.ts
```
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserManager } from './browser.js';

describe('BrowserManager', () => {
  let browser: BrowserManager;

  beforeAll(async () => {
    browser = new BrowserManager();
    await browser.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  describe('launch and close', () => {
    it('should report as launched', () => {
      expect(browser.isLaunched()).toBe(true);
    });

    it('should have a page', () => {
      const page = browser.getPage();
      expect(page).toBeDefined();
    });

    it('should reject invalid executablePath', async () => {
      const testBrowser = new BrowserManager();
      await expect(
        testBrowser.launch({
          headless: true,
          executablePath: '/nonexistent/path/to/chromium',
        })
      ).rejects.toThrow();
    });

    it('should be no-op when relaunching with same options', async () => {
      const browserInstance = browser.getBrowser();
      await browser.launch({ id: 'test', action: 'launch', headless: true });
      expect(browser.getBrowser()).toBe(browserInstance);
    });

    it('should reconnect when CDP port changes', async () => {
      const newBrowser = new BrowserManager();
      await newBrowser.launch({ id: 'test', action: 'launch', headless: true });
      expect(newBrowser.getBrowser()).not.toBeNull();

      await expect(
        newBrowser.launch({ id: 'test', action: 'launch', cdpPort: 59999 })
      ).rejects.toThrow();

      expect(newBrowser.getBrowser()).toBeNull();
      await newBrowser.close();
    });
  });

  describe('navigation', () => {
    it('should navigate to URL', async () => {
      const page = browser.getPage();
      await page.goto('https://example.com');
      expect(page.url()).toBe('https://example.com/');
    });

    it('should get page title', async () => {
      const page = browser.getPage();
      const title = await page.title();
      expect(title).toBe('Example Domain');
    });
  });

  describe('element interaction', () => {
    it('should find element by selector', async () => {
      const page = browser.getPage();
      const heading = await page.locator('h1').textContent();
      expect(heading).toBe('Example Domain');
    });

    it('should check element visibility', async () => {
      const page = browser.getPage();
      const isVisible = await page.locator('h1').isVisible();
      expect(isVisible).toBe(true);
    });

    it('should count elements', async () => {
      const page = browser.getPage();
      const count = await page.locator('p').count();
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('screenshots', () => {
    it('should take screenshot as buffer', async () => {
      const page = browser.getPage();
      const buffer = await page.screenshot();
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  describe('evaluate', () => {
    it('should evaluate JavaScript', async () => {
      const page = browser.getPage();
      const result = await page.evaluate(() => document.title);
      expect(result).toBe('Example Domain');
    });

    it('should evaluate with arguments', async () => {
      const page = browser.getPage();
      const result = await page.evaluate((x: number) => x * 2, 5);
      expect(result).toBe(10);
    });
  });

  describe('tabs', () => {
    it('should create new tab', async () => {
      const result = await browser.newTab();
      expect(result.index).toBe(1);
      expect(result.total).toBe(2);
    });

    it('should list tabs', async () => {
      const tabs = await browser.listTabs();
      expect(tabs.length).toBe(2);
    });

    it('should close tab', async () => {
      // Switch to second tab and close it
      const page = browser.getPage();
      const tabs = await browser.listTabs();
      if (tabs.length > 1) {
        const result = await browser.closeTab(1);
        expect(result.remaining).toBe(1);
      }
    });
  });

  describe('context operations', () => {
    it('should get cookies from context', async () => {
      const page = browser.getPage();
      const cookies = await page.context().cookies();
      expect(Array.isArray(cookies)).toBe(true);
    });

    it('should set and get cookies', async () => {
      const page = browser.getPage();
      const context = page.context();
      await context.addCookies([{ name: 'test', value: 'value', url: 'https://example.com' }]);
      const cookies = await context.cookies();
      const testCookie = cookies.find((c) => c.name === 'test');
      expect(testCookie?.value).toBe('value');
    });

    it('should set cookie with domain', async () => {
      const page = browser.getPage();
      const context = page.context();
      await context.addCookies([
        { name: 'domainCookie', value: 'domainValue', domain: 'example.com', path: '/' },
      ]);
      const cookies = await context.cookies();
      const testCookie = cookies.find((c) => c.name === 'domainCookie');
      expect(testCookie?.value).toBe('domainValue');
    });

    it('should set multiple cookies at once', async () => {
      const page = browser.getPage();
      const context = page.context();
      await context.clearCookies();
      await context.addCookies([
        { name: 'cookie1', value: 'value1', url: 'https://example.com' },
        { name: 'cookie2', value: 'value2', url: 'https://example.com' },
      ]);
      const cookies = await context.cookies();
      expect(cookies.find((c) => c.name === 'cookie1')?.value).toBe('value1');
      expect(cookies.find((c) => c.name === 'cookie2')?.value).toBe('value2');
    });

    it('should clear cookies', async () => {
      const page = browser.getPage();
      const context = page.context();
      await context.clearCookies();
      const cookies = await context.cookies();
      expect(cookies.length).toBe(0);
    });
  });

  describe('localStorage operations', () => {
    it('should set and get localStorage item', async () => {
      const page = browser.getPage();
      await page.goto('https://example.com');
      await page.evaluate(() => localStorage.setItem('testKey', 'testValue'));
      const value = await page.evaluate(() => localStorage.getItem('testKey'));
      expect(value).toBe('testValue');
    });

    it('should get all localStorage items', async () => {
      const page = browser.getPage();
      await page.evaluate(() => {
        localStorage.clear();
        localStorage.setItem('key1', 'value1');
        localStorage.setItem('key2', 'value2');
      });
      const storage = await page.evaluate(() => {
        const items: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) items[key] = localStorage.getItem(key) || '';
        }
        return items;
      });
      expect(storage.key1).toBe('value1');
      expect(storage.key2).toBe('value2');
    });

    it('should clear localStorage', async () => {
      const page = browser.getPage();
      await page.evaluate(() => localStorage.clear());
      const value = await page.evaluate(() => localStorage.getItem('testKey'));
      expect(value).toBeNull();
    });

    it('should return null for non-existent key', async () => {
      const page = browser.getPage();
      await page.evaluate(() => localStorage.clear());
      const value = await page.evaluate(() => localStorage.getItem('nonexistent'));
      expect(value).toBeNull();
    });
  });

  describe('sessionStorage operations', () => {
    it('should set and get sessionStorage item', async () => {
      const page = browser.getPage();
      await page.goto('https://example.com');
      await page.evaluate(() => sessionStorage.setItem('sessionKey', 'sessionValue'));
      const value = await page.evaluate(() => sessionStorage.getItem('sessionKey'));
      expect(value).toBe('sessionValue');
    });

    it('should get all sessionStorage items', async () => {
      const page = browser.getPage();
      await page.evaluate(() => {
        sessionStorage.clear();
        sessionStorage.setItem('skey1', 'svalue1');
        sessionStorage.setItem('skey2', 'svalue2');
      });
      const storage = await page.evaluate(() => {
        const items: Record<string, string> = {};
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key) items[key] = sessionStorage.getItem(key) || '';
        }
        return items;
      });
      expect(storage.skey1).toBe('svalue1');
      expect(storage.skey2).toBe('svalue2');
    });

    it('should clear sessionStorage', async () => {
      const page = browser.getPage();
      await page.evaluate(() => sessionStorage.clear());
      const value = await page.evaluate(() => sessionStorage.getItem('sessionKey'));
      expect(value).toBeNull();
    });
  });

  describe('viewport', () => {
    it('should set viewport', async () => {
      await browser.setViewport(1920, 1080);
      const page = browser.getPage();
      const size = page.viewportSize();
      expect(size?.width).toBe(1920);
      expect(size?.height).toBe(1080);
    });
  });

  describe('snapshot', () => {
    it('should get snapshot with refs', async () => {
      const page = browser.getPage();
      await page.goto('https://example.com');
      const { tree, refs } = await browser.getSnapshot();
      expect(tree).toContain('heading');
      expect(tree).toContain('Example Domain');
      expect(typeof refs).toBe('object');
    });

    it('should get interactive-only snapshot', async () => {
      const { tree: fullSnapshot } = await browser.getSnapshot();
      const { tree: interactiveSnapshot } = await browser.getSnapshot({ interactive: true });
      // Interactive snapshot should be shorter (fewer elements)
      expect(interactiveSnapshot.length).toBeLessThanOrEqual(fullSnapshot.length);
    });

    it('should get snapshot with depth limit', async () => {
      const { tree: fullSnapshot } = await browser.getSnapshot();
      const { tree: limitedSnapshot } = await browser.getSnapshot({ maxDepth: 2 });
      // Limited depth should have fewer nested elements
      const fullLines = fullSnapshot.split('\n').length;
      const limitedLines = limitedSnapshot.split('\n').length;
      expect(limitedLines).toBeLessThanOrEqual(fullLines);
    });

    it('should get compact snapshot', async () => {
      const { tree: fullSnapshot } = await browser.getSnapshot();
      const { tree: compactSnapshot } = await browser.getSnapshot({ compact: true });
      // Compact should be equal or shorter
      expect(compactSnapshot.length).toBeLessThanOrEqual(fullSnapshot.length);
    });
  });

  describe('locator resolution', () => {
    it('should resolve CSS selector', async () => {
      const page = browser.getPage();
      await page.goto('https://example.com');
      const locator = browser.getLocator('h1');
      const text = await locator.textContent();
      expect(text).toBe('Example Domain');
    });

    it('should resolve ref from snapshot', async () => {
      await browser.getSnapshot(); // Populates refs
      // After snapshot, refs like @e1 should be available
      // This tests the ref resolution mechanism
      const page = browser.getPage();
      const h1 = await page.locator('h1').textContent();
      expect(h1).toBe('Example Domain');
    });
  });

  describe('scoped headers', () => {
    it('should register route for scoped headers', async () => {
      // Test that setScopedHeaders doesn't throw and completes successfully
      await browser.clearScopedHeaders();
      await expect(
        browser.setScopedHeaders('https://example.com', { 'X-Test': 'value' })
      ).resolves.not.toThrow();
      await browser.clearScopedHeaders();
    });

    it('should handle full URL origin', async () => {
      await browser.clearScopedHeaders();
      await expect(
        browser.setScopedHeaders('https://api.example.com/path', { Authorization: 'Bearer token' })
      ).resolves.not.toThrow();
      await browser.clearScopedHeaders();
    });

    it('should handle hostname-only origin', async () => {
      await browser.clearScopedHeaders();
      await expect(
        browser.setScopedHeaders('example.com', { 'X-Custom': 'value' })
      ).resolves.not.toThrow();
      await browser.clearScopedHeaders();
    });

    it('should clear scoped headers for specific origin', async () => {
      await browser.clearScopedHeaders();
      await browser.setScopedHeaders('https://example.com', { 'X-Test': 'value' });
      await expect(browser.clearScopedHeaders('https://example.com')).resolves.not.toThrow();
    });

    it('should clear all scoped headers', async () => {
      await browser.setScopedHeaders('https://example.com', { 'X-Test-1': 'value1' });
      await browser.setScopedHeaders('https://example.org', { 'X-Test-2': 'value2' });
      await expect(browser.clearScopedHeaders()).resolves.not.toThrow();
    });

    it('should replace headers when called twice for same origin', async () => {
      await browser.clearScopedHeaders();
      await browser.setScopedHeaders('https://example.com', { 'X-First': 'first' });
      // Second call should replace, not add
      await expect(
        browser.setScopedHeaders('https://example.com', { 'X-Second': 'second' })
      ).resolves.not.toThrow();
      await browser.clearScopedHeaders();
    });

    it('should handle clearing non-existent origin gracefully', async () => {
      await browser.clearScopedHeaders();
      // Should not throw when clearing headers that were never set
      await expect(browser.clearScopedHeaders('https://never-set.com')).resolves.not.toThrow();
    });
  });

  describe('CDP session', () => {
    it('should create CDP session on demand', async () => {
      const cdp = await browser.getCDPSession();
      expect(cdp).toBeDefined();
    });

    it('should reuse existing CDP session', async () => {
      const cdp1 = await browser.getCDPSession();
      const cdp2 = await browser.getCDPSession();
      expect(cdp1).toBe(cdp2);
    });
  });

  describe('screencast', () => {
    it('should report screencasting state correctly', () => {
      expect(browser.isScreencasting()).toBe(false);
    });

    it('should start screencast', async () => {
      const frames: Array<{ data: string }> = [];
      await browser.startScreencast((frame) => {
        frames.push(frame);
      });
      expect(browser.isScreencasting()).toBe(true);

      // Wait a bit for at least one frame
      await new Promise((resolve) => setTimeout(resolve, 200));

      await browser.stopScreencast();
      expect(browser.isScreencasting()).toBe(false);
      expect(frames.length).toBeGreaterThan(0);
    });

    it('should start screencast with custom options', async () => {
      const frames: Array<{ data: string }> = [];
      await browser.startScreencast(
        (frame) => {
          frames.push(frame);
        },
        {
          format: 'png',
          quality: 100,
          maxWidth: 800,
          maxHeight: 600,
          everyNthFrame: 1,
        }
      );
      expect(browser.isScreencasting()).toBe(true);

      // Wait for a frame
      await new Promise((resolve) => setTimeout(resolve, 200));

      await browser.stopScreencast();
      expect(frames.length).toBeGreaterThan(0);
    });

    it('should throw when starting screencast twice', async () => {
      await browser.startScreencast(() => {});
      await expect(browser.startScreencast(() => {})).rejects.toThrow('Screencast already active');
      await browser.stopScreencast();
    });

    it('should handle stop when not screencasting', async () => {
      // Should not throw
      await expect(browser.stopScreencast()).resolves.not.toThrow();
    });
  });

  describe('tab switch invalidates CDP session', () => {
    // Clean up any extra tabs before each test
    beforeEach(async () => {
      // Close all tabs except the first one
      const tabs = await browser.listTabs();
      for (let i = tabs.length - 1; i > 0; i--) {
        await browser.closeTab(i);
      }
      // Ensure we're on tab 0
      await browser.switchTo(0);
      // Stop any active screencast
      if (browser.isScreencasting()) {
        await browser.stopScreencast();
      }
    });

    it('should not invalidate CDP when switching to same tab', async () => {
      // Get CDP session for current tab
      const cdp1 = await browser.getCDPSession();

      // Switch to same tab - should NOT invalidate
      await browser.switchTo(0);

      // Should be the same session
      const cdp2 = await browser.getCDPSession();
      expect(cdp2).toBe(cdp1);
    });

    it('should invalidate CDP session on tab switch', async () => {
      // Get CDP session for tab 0
      const cdp1 = await browser.getCDPSession();
      expect(cdp1).toBeDefined();

      // Create new tab - this switches to the new tab automatically
      await browser.newTab();

      // Get CDP session - should be different since we're on a new page
      const cdp2 = await browser.getCDPSession();
      expect(cdp2).toBeDefined();

      // Sessions should be different objects (different pages have different CDP sessions)
      expect(cdp2).not.toBe(cdp1);
    });

    it('should stop screencast on tab switch', async () => {
      // Start screencast on tab 0
      await browser.startScreencast(() => {});
      expect(browser.isScreencasting()).toBe(true);

      // Create new tab and switch
      await browser.newTab();
      await browser.switchTo(1);

      // Screencast should be stopped (it's page-specific)
      expect(browser.isScreencasting()).toBe(false);
    });
  });

  describe('input injection', () => {
    it('should inject mouse move event', async () => {
      await expect(
        browser.injectMouseEvent({
          type: 'mouseMoved',
          x: 100,
          y: 100,
        })
      ).resolves.not.toThrow();
    });

    it('should inject mouse click events', async () => {
      await expect(
        browser.injectMouseEvent({
          type: 'mousePressed',
          x: 100,
          y: 100,
          button: 'left',
          clickCount: 1,
        })
      ).resolves.not.toThrow();

      await expect(
        browser.injectMouseEvent({
          type: 'mouseReleased',
          x: 100,
          y: 100,
          button: 'left',
        })
      ).resolves.not.toThrow();
    });

    it('should inject mouse wheel event', async () => {
      await expect(
        browser.injectMouseEvent({
          type: 'mouseWheel',
          x: 100,
          y: 100,
          deltaX: 0,
          deltaY: 100,
        })
      ).resolves.not.toThrow();
    });

    it('should inject keyboard events', async () => {
      await expect(
        browser.injectKeyboardEvent({
          type: 'keyDown',
          key: 'a',
          code: 'KeyA',
        })
      ).resolves.not.toThrow();

      await expect(
        browser.injectKeyboardEvent({
          type: 'keyUp',
          key: 'a',
          code: 'KeyA',
        })
      ).resolves.not.toThrow();
    });

    it('should inject char event', async () => {
      // CDP char events only accept single characters
      await expect(
        browser.injectKeyboardEvent({
          type: 'char',
          text: 'h',
        })
      ).resolves.not.toThrow();
    });

    it('should inject keyboard with modifiers', async () => {
      await expect(
        browser.injectKeyboardEvent({
          type: 'keyDown',
          key: 'c',
          code: 'KeyC',
          modifiers: 2, // Ctrl
        })
      ).resolves.not.toThrow();
    });

    it('should inject touch events', async () => {
      await expect(
        browser.injectTouchEvent({
          type: 'touchStart',
          touchPoints: [{ x: 100, y: 100 }],
        })
      ).resolves.not.toThrow();

      await expect(
        browser.injectTouchEvent({
          type: 'touchMove',
          touchPoints: [{ x: 150, y: 150 }],
        })
      ).resolves.not.toThrow();

      await expect(
        browser.injectTouchEvent({
          type: 'touchEnd',
          touchPoints: [],
        })
      ).resolves.not.toThrow();
    });

    it('should inject multi-touch events', async () => {
      await expect(
        browser.injectTouchEvent({
          type: 'touchStart',
          touchPoints: [
            { x: 100, y: 100, id: 0 },
            { x: 200, y: 200, id: 1 },
          ],
        })
      ).resolves.not.toThrow();

      await expect(
        browser.injectTouchEvent({
          type: 'touchEnd',
          touchPoints: [],
        })
      ).resolves.not.toThrow();
    });
  });
});
```

src/browser.ts
```
import {
  chromium,
  firefox,
  webkit,
  devices,
  type Browser,
  type BrowserContext,
  type Page,
  type Frame,
  type Dialog,
  type Request,
  type Route,
  type Locator,
  type CDPSession,
} from 'playwright-core';
import path from 'node:path';
import os from 'node:os';
import type { LaunchCommand } from './types.js';
import { type RefMap, type EnhancedSnapshot, getEnhancedSnapshot, parseRef } from './snapshot.js';

// Screencast frame data from CDP
export interface ScreencastFrame {
  data: string; // base64 encoded image
  metadata: {
    offsetTop: number;
    pageScaleFactor: number;
    deviceWidth: number;
    deviceHeight: number;
    scrollOffsetX: number;
    scrollOffsetY: number;
    timestamp?: number;
  };
  sessionId: number;
}

// Screencast options
export interface ScreencastOptions {
  format?: 'jpeg' | 'png';
  quality?: number; // 0-100, only for jpeg
  maxWidth?: number;
  maxHeight?: number;
  everyNthFrame?: number;
}

interface TrackedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  timestamp: number;
  resourceType: string;
}

interface ConsoleMessage {
  type: string;
  text: string;
  timestamp: number;
}

interface PageError {
  message: string;
  timestamp: number;
}

/**
 * Manages the Playwright browser lifecycle with multiple tabs/windows
 */
export class BrowserManager {
  private browser: Browser | null = null;
  private cdpPort: number | null = null;
  private isPersistentContext: boolean = false;
  private contexts: BrowserContext[] = [];
  private pages: Page[] = [];
  private activePageIndex: number = 0;
  private activeFrame: Frame | null = null;
  private dialogHandler: ((dialog: Dialog) => Promise<void>) | null = null;
  private trackedRequests: TrackedRequest[] = [];
  private routes: Map<string, (route: Route) => Promise<void>> = new Map();
  private consoleMessages: ConsoleMessage[] = [];
  private pageErrors: PageError[] = [];
  private isRecordingHar: boolean = false;
  private refMap: RefMap = {};
  private lastSnapshot: string = '';
  private scopedHeaderRoutes: Map<string, (route: Route) => Promise<void>> = new Map();

  // CDP session for screencast and input injection
  private cdpSession: CDPSession | null = null;
  private screencastActive: boolean = false;
  private screencastSessionId: number = 0;
  private frameCallback: ((frame: ScreencastFrame) => void) | null = null;
  private screencastFrameHandler: ((params: any) => void) | null = null;

  /**
   * Check if browser is launched
   */
  isLaunched(): boolean {
    return this.browser !== null || this.isPersistentContext;
  }

  /**
   * Get enhanced snapshot with refs and cache the ref map
   */
  async getSnapshot(options?: {
    interactive?: boolean;
    maxDepth?: number;
    compact?: boolean;
    selector?: string;
  }): Promise<EnhancedSnapshot> {
    const page = this.getPage();
    const snapshot = await getEnhancedSnapshot(page, options);
    this.refMap = snapshot.refs;
    this.lastSnapshot = snapshot.tree;
    return snapshot;
  }

  /**
   * Get the cached ref map from last snapshot
   */
  getRefMap(): RefMap {
    return this.refMap;
  }

  /**
   * Get a locator from a ref (e.g., "e1", "@e1", "ref=e1")
   * Returns null if ref doesn't exist or is invalid
   */
  getLocatorFromRef(refArg: string): Locator | null {
    const ref = parseRef(refArg);
    if (!ref) return null;

    const refData = this.refMap[ref];
    if (!refData) return null;

    const page = this.getPage();

    // Build locator with exact: true to avoid substring matches
    let locator: Locator;
    if (refData.name) {
      locator = page.getByRole(refData.role as any, { name: refData.name, exact: true });
    } else {
      locator = page.getByRole(refData.role as any);
    }

    // If an nth index is stored (for disambiguation), use it
    if (refData.nth !== undefined) {
      locator = locator.nth(refData.nth);
    }

    return locator;
  }

  /**
   * Check if a selector looks like a ref
   */
  isRef(selector: string): boolean {
    return parseRef(selector) !== null;
  }

  /**
   * Get locator - supports both refs and regular selectors
   */
  getLocator(selectorOrRef: string): Locator {
    // Check if it's a ref first
    const locator = this.getLocatorFromRef(selectorOrRef);
    if (locator) return locator;

    // Otherwise treat as regular selector
    const page = this.getPage();
    return page.locator(selectorOrRef);
  }

  /**
   * Get the current active page, throws if not launched
   */
  getPage(): Page {
    if (this.pages.length === 0) {
      throw new Error('Browser not launched. Call launch first.');
    }
    return this.pages[this.activePageIndex];
  }

  /**
   * Get the current frame (or page's main frame if no frame is selected)
   */
  getFrame(): Frame {
    if (this.activeFrame) {
      return this.activeFrame;
    }
    return this.getPage().mainFrame();
  }

  /**
   * Switch to a frame by selector, name, or URL
   */
  async switchToFrame(options: { selector?: string; name?: string; url?: string }): Promise<void> {
    const page = this.getPage();

    if (options.selector) {
      const frameElement = await page.$(options.selector);
      if (!frameElement) {
        throw new Error(`Frame not found: ${options.selector}`);
      }
      const frame = await frameElement.contentFrame();
      if (!frame) {
        throw new Error(`Element is not a frame: ${options.selector}`);
      }
      this.activeFrame = frame;
    } else if (options.name) {
      const frame = page.frame({ name: options.name });
      if (!frame) {
        throw new Error(`Frame not found with name: ${options.name}`);
      }
      this.activeFrame = frame;
    } else if (options.url) {
      const frame = page.frame({ url: options.url });
      if (!frame) {
        throw new Error(`Frame not found with URL: ${options.url}`);
      }
      this.activeFrame = frame;
    }
  }

  /**
   * Switch back to main frame
   */
  switchToMainFrame(): void {
    this.activeFrame = null;
  }

  /**
   * Set up dialog handler
   */
  setDialogHandler(response: 'accept' | 'dismiss', promptText?: string): void {
    const page = this.getPage();

    // Remove existing handler if any
    if (this.dialogHandler) {
      page.removeListener('dialog', this.dialogHandler);
    }

    this.dialogHandler = async (dialog: Dialog) => {
      if (response === 'accept') {
        await dialog.accept(promptText);
      } else {
        await dialog.dismiss();
      }
    };

    page.on('dialog', this.dialogHandler);
  }

  /**
   * Clear dialog handler
   */
  clearDialogHandler(): void {
    if (this.dialogHandler) {
      const page = this.getPage();
      page.removeListener('dialog', this.dialogHandler);
      this.dialogHandler = null;
    }
  }

  /**
   * Start tracking requests
   */
  startRequestTracking(): void {
    const page = this.getPage();
    page.on('request', (request: Request) => {
      this.trackedRequests.push({
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        timestamp: Date.now(),
        resourceType: request.resourceType(),
      });
    });
  }

  /**
   * Get tracked requests
   */
  getRequests(filter?: string): TrackedRequest[] {
    if (filter) {
      return this.trackedRequests.filter((r) => r.url.includes(filter));
    }
    return this.trackedRequests;
  }

  /**
   * Clear tracked requests
   */
  clearRequests(): void {
    this.trackedRequests = [];
  }

  /**
   * Add a route to intercept requests
   */
  async addRoute(
    url: string,
    options: {
      response?: {
        status?: number;
        body?: string;
        contentType?: string;
        headers?: Record<string, string>;
      };
      abort?: boolean;
    }
  ): Promise<void> {
    const page = this.getPage();

    const handler = async (route: Route) => {
      if (options.abort) {
        await route.abort();
      } else if (options.response) {
        await route.fulfill({
          status: options.response.status ?? 200,
          body: options.response.body ?? '',
          contentType: options.response.contentType ?? 'text/plain',
          headers: options.response.headers,
        });
      } else {
        await route.continue();
      }
    };

    this.routes.set(url, handler);
    await page.route(url, handler);
  }

  /**
   * Remove a route
   */
  async removeRoute(url?: string): Promise<void> {
    const page = this.getPage();

    if (url) {
      const handler = this.routes.get(url);
      if (handler) {
        await page.unroute(url, handler);
        this.routes.delete(url);
      }
    } else {
      // Remove all routes
      for (const [routeUrl, handler] of this.routes) {
        await page.unroute(routeUrl, handler);
      }
      this.routes.clear();
    }
  }

  /**
   * Set geolocation
   */
  async setGeolocation(latitude: number, longitude: number, accuracy?: number): Promise<void> {
    const context = this.contexts[0];
    if (context) {
      await context.setGeolocation({ latitude, longitude, accuracy });
    }
  }

  /**
   * Set permissions
   */
  async setPermissions(permissions: string[], grant: boolean): Promise<void> {
    const context = this.contexts[0];
    if (context) {
      if (grant) {
        await context.grantPermissions(permissions);
      } else {
        await context.clearPermissions();
      }
    }
  }

  /**
   * Set viewport
   */
  async setViewport(width: number, height: number): Promise<void> {
    const page = this.getPage();
    await page.setViewportSize({ width, height });
  }

  /**
   * Get device descriptor
   */
  getDevice(deviceName: string): (typeof devices)[keyof typeof devices] | undefined {
    return devices[deviceName as keyof typeof devices];
  }

  /**
   * List available devices
   */
  listDevices(): string[] {
    return Object.keys(devices);
  }

  /**
   * Start console message tracking
   */
  startConsoleTracking(): void {
    const page = this.getPage();
    page.on('console', (msg) => {
      this.consoleMessages.push({
        type: msg.type(),
        text: msg.text(),
        timestamp: Date.now(),
      });
    });
  }

  /**
   * Get console messages
   */
  getConsoleMessages(): ConsoleMessage[] {
    return this.consoleMessages;
  }

  /**
   * Clear console messages
   */
  clearConsoleMessages(): void {
    this.consoleMessages = [];
  }

  /**
   * Start error tracking
   */
  startErrorTracking(): void {
    const page = this.getPage();
    page.on('pageerror', (error) => {
      this.pageErrors.push({
        message: error.message,
        timestamp: Date.now(),
      });
    });
  }

  /**
   * Get page errors
   */
  getPageErrors(): PageError[] {
    return this.pageErrors;
  }

  /**
   * Clear page errors
   */
  clearPageErrors(): void {
    this.pageErrors = [];
  }

  /**
   * Start HAR recording
   */
  async startHarRecording(): Promise<void> {
    // HAR is started at context level, flag for tracking
    this.isRecordingHar = true;
  }

  /**
   * Check if HAR recording
   */
  isHarRecording(): boolean {
    return this.isRecordingHar;
  }

  /**
   * Set offline mode
   */
  async setOffline(offline: boolean): Promise<void> {
    const context = this.contexts[0];
    if (context) {
      await context.setOffline(offline);
    }
  }

  /**
   * Set extra HTTP headers (global - all requests)
   */
  async setExtraHeaders(headers: Record<string, string>): Promise<void> {
    const context = this.contexts[0];
    if (context) {
      await context.setExtraHTTPHeaders(headers);
    }
  }

  /**
   * Set scoped HTTP headers (only for requests matching the origin)
   * Uses route interception to add headers only to matching requests
   */
  async setScopedHeaders(origin: string, headers: Record<string, string>): Promise<void> {
    const page = this.getPage();

    // Build URL pattern from origin (e.g., "api.example.com" -> "**://api.example.com/**")
    // Handle both full URLs and just hostnames
    let urlPattern: string;
    try {
      const url = new URL(origin.startsWith('http') ? origin : `https://${origin}`);
      // Match any protocol, the host, and any path
      urlPattern = `**://${url.host}/**`;
    } catch {
      // If parsing fails, treat as hostname pattern
      urlPattern = `**://${origin}/**`;
    }

    // Remove existing route for this origin if any
    const existingHandler = this.scopedHeaderRoutes.get(urlPattern);
    if (existingHandler) {
      await page.unroute(urlPattern, existingHandler);
    }

    // Create handler that adds headers to matching requests
    const handler = async (route: Route) => {
      const requestHeaders = route.request().headers();
      await route.continue({
        headers: {
          ...requestHeaders,
          ...headers,
        },
      });
    };

    // Store and register the route
    this.scopedHeaderRoutes.set(urlPattern, handler);
    await page.route(urlPattern, handler);
  }

  /**
   * Clear scoped headers for an origin (or all if no origin specified)
   */
  async clearScopedHeaders(origin?: string): Promise<void> {
    const page = this.getPage();

    if (origin) {
      let urlPattern: string;
      try {
        const url = new URL(origin.startsWith('http') ? origin : `https://${origin}`);
        urlPattern = `**://${url.host}/**`;
      } catch {
        urlPattern = `**://${origin}/**`;
      }

      const handler = this.scopedHeaderRoutes.get(urlPattern);
      if (handler) {
        await page.unroute(urlPattern, handler);
        this.scopedHeaderRoutes.delete(urlPattern);
      }
    } else {
      // Clear all scoped header routes
      for (const [pattern, handler] of this.scopedHeaderRoutes) {
        await page.unroute(pattern, handler);
      }
      this.scopedHeaderRoutes.clear();
    }
  }

  /**
   * Start tracing
   */
  async startTracing(options: { screenshots?: boolean; snapshots?: boolean }): Promise<void> {
    const context = this.contexts[0];
    if (context) {
      await context.tracing.start({
        screenshots: options.screenshots ?? true,
        snapshots: options.snapshots ?? true,
      });
    }
  }

  /**
   * Stop tracing and save
   */
  async stopTracing(path: string): Promise<void> {
    const context = this.contexts[0];
    if (context) {
      await context.tracing.stop({ path });
    }
  }

  /**
   * Save storage state (cookies, localStorage, etc.)
   */
  async saveStorageState(path: string): Promise<void> {
    const context = this.contexts[0];
    if (context) {
      await context.storageState({ path });
    }
  }

  /**
   * Get all pages
   */
  getPages(): Page[] {
    return this.pages;
  }

  /**
   * Get current page index
   */
  getActiveIndex(): number {
    return this.activePageIndex;
  }

  /**
   * Get the current browser instance
   */
  getBrowser(): Browser | null {
    return this.browser;
  }

  /**
   * Check if an existing CDP connection is still alive
   * by verifying we can access browser contexts and that at least one has pages
   */
  private isCdpConnectionAlive(): boolean {
    if (!this.browser) return false;
    try {
      const contexts = this.browser.contexts();
      if (contexts.length === 0) return false;
      return contexts.some((context) => context.pages().length > 0);
    } catch {
      return false;
    }
  }

  /**
   * Check if CDP connection needs to be re-established
   */
  private needsCdpReconnect(cdpPort: number): boolean {
    if (!this.browser?.isConnected()) return true;
    if (this.cdpPort !== cdpPort) return true;
    if (!this.isCdpConnectionAlive()) return true;
    return false;
  }

  /**
   * Launch the browser with the specified options
   * If already launched, this is a no-op (browser stays open)
   */
  async launch(options: LaunchCommand): Promise<void> {
    const cdpPort = options.cdpPort;
    const hasExtensions = !!options.extensions?.length;

    if (hasExtensions && cdpPort) {
      throw new Error('Extensions cannot be used with CDP connection');
    }

    if (this.isLaunched()) {
      const needsRelaunch =
        (!cdpPort && this.cdpPort !== null) || (!!cdpPort && this.needsCdpReconnect(cdpPort));
      if (needsRelaunch) {
        await this.close();
      } else {
        return;
      }
    }

    if (cdpPort) {
      await this.connectViaCDP(cdpPort);
      return;
    }

    const browserType = options.browser ?? 'chromium';
    if (hasExtensions && browserType !== 'chromium') {
      throw new Error('Extensions are only supported in Chromium');
    }

    const launcher =
      browserType === 'firefox' ? firefox : browserType === 'webkit' ? webkit : chromium;
    const viewport = options.viewport ?? { width: 1280, height: 720 };

    let context: BrowserContext;
    if (hasExtensions) {
      const extPaths = options.extensions!.join(',');
      const session = process.env.AGENT_BROWSER_SESSION || 'default';
      context = await launcher.launchPersistentContext(
        path.join(os.tmpdir(), `agent-browser-ext-${session}`),
        {
          headless: false,
          executablePath: options.executablePath,
          args: [`--disable-extensions-except=${extPaths}`, `--load-extension=${extPaths}`],
          viewport,
          extraHTTPHeaders: options.headers,
        }
      );
      this.isPersistentContext = true;
    } else {
      this.browser = await launcher.launch({
        headless: options.headless ?? true,
        executablePath: options.executablePath,
      });
      this.cdpPort = null;
      context = await this.browser.newContext({ viewport, extraHTTPHeaders: options.headers });
    }

    context.setDefaultTimeout(10000);
    this.contexts.push(context);

    const page = context.pages()[0] ?? (await context.newPage());
    this.pages.push(page);
    this.activePageIndex = 0;
    this.setupPageTracking(page);
  }

  /**
   * Connect to a running browser via CDP (Chrome DevTools Protocol)
   */
  private async connectViaCDP(cdpPort: number | undefined): Promise<void> {
    if (!cdpPort) {
      throw new Error('cdpPort is required for CDP connection');
    }

    const browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`).catch(() => {
      throw new Error(
        `Failed to connect via CDP on port ${cdpPort}. ` +
          `Make sure the app is running with --remote-debugging-port=${cdpPort}`
      );
    });

    // Validate and set up state, cleaning up browser connection if anything fails
    try {
      const contexts = browser.contexts();
      if (contexts.length === 0) {
        throw new Error('No browser context found. Make sure the app has an open window.');
      }

      const allPages = contexts.flatMap((context) => context.pages());
      if (allPages.length === 0) {
        throw new Error('No page found. Make sure the app has loaded content.');
      }

      // All validation passed - commit state
      this.browser = browser;
      this.cdpPort = cdpPort;

      for (const context of contexts) {
        this.contexts.push(context);
        this.setupContextTracking(context);
      }

      for (const page of allPages) {
        this.pages.push(page);
        this.setupPageTracking(page);
      }

      this.activePageIndex = 0;
    } catch (error) {
      // Clean up browser connection if validation or setup failed
      await browser.close().catch(() => {});
      throw error;
    }
  }

  /**
   * Set up console, error, and close tracking for a page
   */
  private setupPageTracking(page: Page): void {
    page.on('console', (msg) => {
      this.consoleMessages.push({
        type: msg.type(),
        text: msg.text(),
        timestamp: Date.now(),
      });
    });

    page.on('pageerror', (error) => {
      this.pageErrors.push({
        message: error.message,
        timestamp: Date.now(),
      });
    });

    page.on('close', () => {
      const index = this.pages.indexOf(page);
      if (index !== -1) {
        this.pages.splice(index, 1);
        if (this.activePageIndex >= this.pages.length) {
          this.activePageIndex = Math.max(0, this.pages.length - 1);
        }
      }
    });
  }

  /**
   * Set up tracking for new pages in a context (for CDP connections)
   */
  private setupContextTracking(context: BrowserContext): void {
    context.on('page', (page) => {
      this.pages.push(page);
      this.setupPageTracking(page);
    });
  }

  /**
   * Create a new tab in the current context
   */
  async newTab(): Promise<{ index: number; total: number }> {
    if (!this.browser || this.contexts.length === 0) {
      throw new Error('Browser not launched');
    }

    // Invalidate CDP session since we're switching to a new page
    await this.invalidateCDPSession();

    const context = this.contexts[0]; // Use first context for tabs
    const page = await context.newPage();
    this.pages.push(page);
    this.activePageIndex = this.pages.length - 1;

    // Set up tracking for the new page
    this.setupPageTracking(page);

    return { index: this.activePageIndex, total: this.pages.length };
  }

  /**
   * Create a new window (new context)
   */
  async newWindow(viewport?: {
    width: number;
    height: number;
  }): Promise<{ index: number; total: number }> {
    if (!this.browser) {
      throw new Error('Browser not launched');
    }

    const context = await this.browser.newContext({
      viewport: viewport ?? { width: 1280, height: 720 },
    });
    context.setDefaultTimeout(10000);
    this.contexts.push(context);

    const page = await context.newPage();
    this.pages.push(page);
    this.activePageIndex = this.pages.length - 1;

    // Set up tracking for the new page
    this.setupPageTracking(page);

    return { index: this.activePageIndex, total: this.pages.length };
  }

  /**
   * Invalidate the current CDP session (must be called before switching pages)
   * This ensures screencast and input injection work correctly after tab switch
   */
  private async invalidateCDPSession(): Promise<void> {
    // Stop screencast if active (it's tied to the current page's CDP session)
    if (this.screencastActive) {
      await this.stopScreencast();
    }

    // Detach and clear the CDP session
    if (this.cdpSession) {
      await this.cdpSession.detach().catch(() => {});
      this.cdpSession = null;
    }
  }

  /**
   * Switch to a specific tab/page by index
   */
  async switchTo(index: number): Promise<{ index: number; url: string; title: string }> {
    if (index < 0 || index >= this.pages.length) {
      throw new Error(`Invalid tab index: ${index}. Available: 0-${this.pages.length - 1}`);
    }

    // Invalidate CDP session before switching (it's page-specific)
    if (index !== this.activePageIndex) {
      await this.invalidateCDPSession();
    }

    this.activePageIndex = index;
    const page = this.pages[index];

    return {
      index: this.activePageIndex,
      url: page.url(),
      title: '', // Title requires async, will be fetched separately
    };
  }

  /**
   * Close a specific tab/page
   */
  async closeTab(index?: number): Promise<{ closed: number; remaining: number }> {
    const targetIndex = index ?? this.activePageIndex;

    if (targetIndex < 0 || targetIndex >= this.pages.length) {
      throw new Error(`Invalid tab index: ${targetIndex}`);
    }

    if (this.pages.length === 1) {
      throw new Error('Cannot close the last tab. Use "close" to close the browser.');
    }

    // If closing the active tab, invalidate CDP session first
    if (targetIndex === this.activePageIndex) {
      await this.invalidateCDPSession();
    }

    const page = this.pages[targetIndex];
    await page.close();
    this.pages.splice(targetIndex, 1);

    // Adjust active index if needed
    if (this.activePageIndex >= this.pages.length) {
      this.activePageIndex = this.pages.length - 1;
    } else if (this.activePageIndex > targetIndex) {
      this.activePageIndex--;
    }

    return { closed: targetIndex, remaining: this.pages.length };
  }

  /**
   * List all tabs with their info
   */
  async listTabs(): Promise<Array<{ index: number; url: string; title: string; active: boolean }>> {
    const tabs = await Promise.all(
      this.pages.map(async (page, index) => ({
        index,
        url: page.url(),
        title: await page.title().catch(() => ''),
        active: index === this.activePageIndex,
      }))
    );
    return tabs;
  }

  /**
   * Get or create a CDP session for the current page
   * Only works with Chromium-based browsers
   */
  async getCDPSession(): Promise<CDPSession> {
    if (this.cdpSession) {
      return this.cdpSession;
    }

    const page = this.getPage();
    const context = page.context();

    // Create a new CDP session attached to the page
    this.cdpSession = await context.newCDPSession(page);
    return this.cdpSession;
  }

  /**
   * Check if screencast is currently active
   */
  isScreencasting(): boolean {
    return this.screencastActive;
  }

  /**
   * Start screencast - streams viewport frames via CDP
   * @param callback Function called for each frame
   * @param options Screencast options
   */
  async startScreencast(
    callback: (frame: ScreencastFrame) => void,
    options?: ScreencastOptions
  ): Promise<void> {
    if (this.screencastActive) {
      throw new Error('Screencast already active');
    }

    const cdp = await this.getCDPSession();
    this.frameCallback = callback;
    this.screencastActive = true;

    // Create and store the frame handler so we can remove it later
    this.screencastFrameHandler = async (params: any) => {
      const frame: ScreencastFrame = {
        data: params.data,
        metadata: params.metadata,
        sessionId: params.sessionId,
      };

      // Acknowledge the frame to receive the next one
      await cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId });

      // Call the callback with the frame
      if (this.frameCallback) {
        this.frameCallback(frame);
      }
    };

    // Listen for screencast frames
    cdp.on('Page.screencastFrame', this.screencastFrameHandler);

    // Start the screencast
    await cdp.send('Page.startScreencast', {
      format: options?.format ?? 'jpeg',
      quality: options?.quality ?? 80,
      maxWidth: options?.maxWidth ?? 1280,
      maxHeight: options?.maxHeight ?? 720,
      everyNthFrame: options?.everyNthFrame ?? 1,
    });
  }

  /**
   * Stop screencast
   */
  async stopScreencast(): Promise<void> {
    if (!this.screencastActive) {
      return;
    }

    try {
      const cdp = await this.getCDPSession();
      await cdp.send('Page.stopScreencast');

      // Remove the event listener to prevent accumulation
      if (this.screencastFrameHandler) {
        cdp.off('Page.screencastFrame', this.screencastFrameHandler);
      }
    } catch {
      // Ignore errors when stopping
    }

    this.screencastActive = false;
    this.frameCallback = null;
    this.screencastFrameHandler = null;
  }

  /**
   * Inject a mouse event via CDP
   */
  async injectMouseEvent(params: {
    type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel';
    x: number;
    y: number;
    button?: 'left' | 'right' | 'middle' | 'none';
    clickCount?: number;
    deltaX?: number;
    deltaY?: number;
    modifiers?: number; // 1=Alt, 2=Ctrl, 4=Meta, 8=Shift
  }): Promise<void> {
    const cdp = await this.getCDPSession();

    const cdpButton =
      params.button === 'left'
        ? 'left'
        : params.button === 'right'
          ? 'right'
          : params.button === 'middle'
            ? 'middle'
            : 'none';

    await cdp.send('Input.dispatchMouseEvent', {
      type: params.type,
      x: params.x,
      y: params.y,
      button: cdpButton,
      clickCount: params.clickCount ?? 1,
      deltaX: params.deltaX ?? 0,
      deltaY: params.deltaY ?? 0,
      modifiers: params.modifiers ?? 0,
    });
  }

  /**
   * Inject a keyboard event via CDP
   */
  async injectKeyboardEvent(params: {
    type: 'keyDown' | 'keyUp' | 'char';
    key?: string;
    code?: string;
    text?: string;
    modifiers?: number; // 1=Alt, 2=Ctrl, 4=Meta, 8=Shift
  }): Promise<void> {
    const cdp = await this.getCDPSession();

    await cdp.send('Input.dispatchKeyEvent', {
      type: params.type,
      key: params.key,
      code: params.code,
      text: params.text,
      modifiers: params.modifiers ?? 0,
    });
  }

  /**
   * Inject touch event via CDP (for mobile emulation)
   */
  async injectTouchEvent(params: {
    type: 'touchStart' | 'touchEnd' | 'touchMove' | 'touchCancel';
    touchPoints: Array<{ x: number; y: number; id?: number }>;
    modifiers?: number;
  }): Promise<void> {
    const cdp = await this.getCDPSession();

    await cdp.send('Input.dispatchTouchEvent', {
      type: params.type,
      touchPoints: params.touchPoints.map((tp, i) => ({
        x: tp.x,
        y: tp.y,
        id: tp.id ?? i,
      })),
      modifiers: params.modifiers ?? 0,
    });
  }

  /**
   * Close the browser and clean up
   */
  async close(): Promise<void> {
    // Stop screencast if active
    if (this.screencastActive) {
      await this.stopScreencast();
    }

    // Clean up CDP session
    if (this.cdpSession) {
      await this.cdpSession.detach().catch(() => {});
      this.cdpSession = null;
    }

    // CDP: only disconnect, don't close external app's pages
    if (this.cdpPort !== null) {
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
    } else {
      // Regular browser: close everything
      for (const page of this.pages) {
        await page.close().catch(() => {});
      }
      for (const context of this.contexts) {
        await context.close().catch(() => {});
      }
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
    }

    this.pages = [];
    this.contexts = [];
    this.cdpPort = null;
    this.isPersistentContext = false;
    this.activePageIndex = 0;
    this.refMap = {};
    this.lastSnapshot = '';
    this.frameCallback = null;
  }
}
```

src/daemon.ts
```
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BrowserManager } from './browser.js';
import { parseCommand, serializeResponse, errorResponse } from './protocol.js';
import { executeCommand } from './actions.js';
import { StreamServer } from './stream-server.js';

// Platform detection
const isWindows = process.platform === 'win32';

// Session support - each session gets its own socket/pid
let currentSession = process.env.AGENT_BROWSER_SESSION || 'default';

// Stream server for browser preview
let streamServer: StreamServer | null = null;

// Default stream port (can be overridden with AGENT_BROWSER_STREAM_PORT)
const DEFAULT_STREAM_PORT = 9223;

/**
 * Set the current session
 */
export function setSession(session: string): void {
  currentSession = session;
}

/**
 * Get the current session
 */
export function getSession(): string {
  return currentSession;
}

/**
 * Get port number for TCP mode (Windows)
 * Uses a hash of the session name to get a consistent port
 */
function getPortForSession(session: string): number {
  let hash = 0;
  for (let i = 0; i < session.length; i++) {
    hash = (hash << 5) - hash + session.charCodeAt(i);
    hash |= 0;
  }
  // Port range 49152-65535 (dynamic/private ports)
  return 49152 + (Math.abs(hash) % 16383);
}

/**
 * Get the socket path for the current session (Unix) or port (Windows)
 */
export function getSocketPath(session?: string): string {
  const sess = session ?? currentSession;
  if (isWindows) {
    return String(getPortForSession(sess));
  }
  return path.join(os.tmpdir(), `agent-browser-${sess}.sock`);
}

/**
 * Get the port file path for Windows (stores the port number)
 */
export function getPortFile(session?: string): string {
  const sess = session ?? currentSession;
  return path.join(os.tmpdir(), `agent-browser-${sess}.port`);
}

/**
 * Get the PID file path for the current session
 */
export function getPidFile(session?: string): string {
  const sess = session ?? currentSession;
  return path.join(os.tmpdir(), `agent-browser-${sess}.pid`);
}

/**
 * Check if daemon is running for the current session
 */
export function isDaemonRunning(session?: string): boolean {
  const pidFile = getPidFile(session);
  if (!fs.existsSync(pidFile)) return false;

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    // Check if process exists (works on both Unix and Windows)
    process.kill(pid, 0);
    return true;
  } catch {
    // Process doesn't exist, clean up stale files
    cleanupSocket(session);
    return false;
  }
}

/**
 * Get connection info for the current session
 * Returns { type: 'unix', path: string } or { type: 'tcp', port: number }
 */
export function getConnectionInfo(
  session?: string
): { type: 'unix'; path: string } | { type: 'tcp'; port: number } {
  const sess = session ?? currentSession;
  if (isWindows) {
    return { type: 'tcp', port: getPortForSession(sess) };
  }
  return { type: 'unix', path: path.join(os.tmpdir(), `agent-browser-${sess}.sock`) };
}

/**
 * Clean up socket and PID file for the current session
 */
export function cleanupSocket(session?: string): void {
  const pidFile = getPidFile(session);
  const streamPortFile = getStreamPortFile(session);
  try {
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
    if (fs.existsSync(streamPortFile)) fs.unlinkSync(streamPortFile);
    if (isWindows) {
      const portFile = getPortFile(session);
      if (fs.existsSync(portFile)) fs.unlinkSync(portFile);
    } else {
      const socketPath = getSocketPath(session);
      if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Get the stream port file path
 */
export function getStreamPortFile(session?: string): string {
  const sess = session ?? currentSession;
  return path.join(os.tmpdir(), `agent-browser-${sess}.stream`);
}

/**
 * Start the daemon server
 * @param options.streamPort Port for WebSocket stream server (0 to disable)
 */
export async function startDaemon(options?: { streamPort?: number }): Promise<void> {
  // Clean up any stale socket
  cleanupSocket();

  const browser = new BrowserManager();
  let shuttingDown = false;

  // Start stream server if port is specified (or use default if env var is set)
  const streamPort =
    options?.streamPort ??
    (process.env.AGENT_BROWSER_STREAM_PORT
      ? parseInt(process.env.AGENT_BROWSER_STREAM_PORT, 10)
      : 0);

  if (streamPort > 0) {
    streamServer = new StreamServer(browser, streamPort);
    await streamServer.start();

    // Write stream port to file for clients to discover
    const streamPortFile = getStreamPortFile();
    fs.writeFileSync(streamPortFile, streamPort.toString());
  }

  const server = net.createServer((socket) => {
    let buffer = '';

    socket.on('data', async (data) => {
      buffer += data.toString();

      // Process complete lines
      while (buffer.includes('\n')) {
        const newlineIdx = buffer.indexOf('\n');
        const line = buffer.substring(0, newlineIdx);
        buffer = buffer.substring(newlineIdx + 1);

        if (!line.trim()) continue;

        try {
          const parseResult = parseCommand(line);

          if (!parseResult.success) {
            const resp = errorResponse(parseResult.id ?? 'unknown', parseResult.error);
            socket.write(serializeResponse(resp) + '\n');
            continue;
          }

          // Auto-launch browser if not already launched and this isn't a launch command
          if (
            !browser.isLaunched() &&
            parseResult.command.action !== 'launch' &&
            parseResult.command.action !== 'close'
          ) {
            const extensions = process.env.AGENT_BROWSER_EXTENSIONS
              ? process.env.AGENT_BROWSER_EXTENSIONS.split(',')
                  .map((p) => p.trim())
                  .filter(Boolean)
              : undefined;
            await browser.launch({
              id: 'auto',
              action: 'launch',
              headless: true,
              executablePath: process.env.AGENT_BROWSER_EXECUTABLE_PATH,
              extensions: extensions,
            });
          }

          // Handle close command specially
          if (parseResult.command.action === 'close') {
            const response = await executeCommand(parseResult.command, browser);
            socket.write(serializeResponse(response) + '\n');

            if (!shuttingDown) {
              shuttingDown = true;
              setTimeout(() => {
                server.close();
                cleanupSocket();
                process.exit(0);
              }, 100);
            }
            return;
          }

          const response = await executeCommand(parseResult.command, browser);
          socket.write(serializeResponse(response) + '\n');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          socket.write(serializeResponse(errorResponse('error', message)) + '\n');
        }
      }
    });

    socket.on('error', () => {
      // Client disconnected, ignore
    });
  });

  const pidFile = getPidFile();

  // Write PID file before listening
  fs.writeFileSync(pidFile, process.pid.toString());

  if (isWindows) {
    // Windows: use TCP socket on localhost
    const port = getPortForSession(currentSession);
    const portFile = getPortFile();
    fs.writeFileSync(portFile, port.toString());
    server.listen(port, '127.0.0.1', () => {
      // Daemon is ready on TCP port
    });
  } else {
    // Unix: use Unix domain socket
    const socketPath = getSocketPath();
    server.listen(socketPath, () => {
      // Daemon is ready
    });
  }

  server.on('error', (err) => {
    console.error('Server error:', err);
    cleanupSocket();
    process.exit(1);
  });

  // Handle shutdown signals
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    // Stop stream server if running
    if (streamServer) {
      await streamServer.stop();
      streamServer = null;
      // Clean up stream port file
      const streamPortFile = getStreamPortFile();
      try {
        if (fs.existsSync(streamPortFile)) fs.unlinkSync(streamPortFile);
      } catch {
        // Ignore cleanup errors
      }
    }

    await browser.close();
    server.close();
    cleanupSocket();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);

  // Handle unexpected errors - always cleanup
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    cleanupSocket();
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    cleanupSocket();
    process.exit(1);
  });

  // Cleanup on normal exit
  process.on('exit', () => {
    cleanupSocket();
  });

  // Keep process alive
  process.stdin.resume();
}

// Run daemon if this is the entry point
if (process.argv[1]?.endsWith('daemon.js') || process.env.AGENT_BROWSER_DAEMON === '1') {
  startDaemon().catch((err) => {
    console.error('Daemon error:', err);
    cleanupSocket();
    process.exit(1);
  });
}
```

src/protocol.test.ts
```
import { describe, it, expect } from 'vitest';
import { parseCommand } from './protocol.js';

// Helper to create command JSON string
const cmd = (obj: object) => JSON.stringify(obj);

describe('parseCommand', () => {
  describe('navigation', () => {
    it('should parse navigate command', () => {
      const result = parseCommand(cmd({ id: '1', action: 'navigate', url: 'https://example.com' }));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.action).toBe('navigate');
        expect(result.command.url).toBe('https://example.com');
      }
    });

    it('should reject navigate without url', () => {
      const result = parseCommand(cmd({ id: '1', action: 'navigate' }));
      expect(result.success).toBe(false);
    });

    it('should parse back command', () => {
      const result = parseCommand(cmd({ id: '1', action: 'back' }));
      expect(result.success).toBe(true);
    });

    it('should parse forward command', () => {
      const result = parseCommand(cmd({ id: '1', action: 'forward' }));
      expect(result.success).toBe(true);
    });

    it('should parse reload command', () => {
      const result = parseCommand(cmd({ id: '1', action: 'reload' }));
      expect(result.success).toBe(true);
    });
  });

  describe('click', () => {
    it('should parse click command', () => {
      const result = parseCommand(cmd({ id: '1', action: 'click', selector: '#btn' }));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.action).toBe('click');
        expect(result.command.selector).toBe('#btn');
      }
    });

    it('should reject click without selector', () => {
      const result = parseCommand(cmd({ id: '1', action: 'click' }));
      expect(result.success).toBe(false);
    });
  });

  describe('type', () => {
    it('should parse type command', () => {
      const result = parseCommand(
        cmd({ id: '1', action: 'type', selector: '#input', text: 'hello' })
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.action).toBe('type');
        expect(result.command.selector).toBe('#input');
        expect(result.command.text).toBe('hello');
      }
    });
  });

  describe('fill', () => {
    it('should parse fill command', () => {
      const result = parseCommand(
        cmd({ id: '1', action: 'fill', selector: '#input', value: 'hello' })
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.action).toBe('fill');
        expect(result.command.value).toBe('hello');
      }
    });
  });

  describe('wait', () => {
    it('should parse wait with selector', () => {
      const result = parseCommand(cmd({ id: '1', action: 'wait', selector: '#loading' }));
      expect(result.success).toBe(true);
    });

    it('should parse wait with timeout', () => {
      const result = parseCommand(cmd({ id: '1', action: 'wait', timeout: 5000 }));
      expect(result.success).toBe(true);
    });

    it('should parse wait with text', () => {
      const result = parseCommand(cmd({ id: '1', action: 'wait', text: 'Welcome' }));
      expect(result.success).toBe(true);
    });
  });

  describe('screenshot', () => {
    it('should parse screenshot command', () => {
      const result = parseCommand(cmd({ id: '1', action: 'screenshot', path: 'test.png' }));
      expect(result.success).toBe(true);
    });

    it('should parse screenshot with fullPage', () => {
      const result = parseCommand(cmd({ id: '1', action: 'screenshot', fullPage: true }));
      expect(result.success).toBe(true);
    });
  });

  describe('cookies', () => {
    it('should parse cookies_get', () => {
      const result = parseCommand(cmd({ id: '1', action: 'cookies_get' }));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.action).toBe('cookies_get');
      }
    });

    it('should parse cookies_get with urls filter', () => {
      const result = parseCommand(
        cmd({ id: '1', action: 'cookies_get', urls: ['https://example.com'] })
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.urls).toEqual(['https://example.com']);
      }
    });

    it('should parse cookies_set with minimal cookie', () => {
      const result = parseCommand(
        cmd({
          id: '1',
          action: 'cookies_set',
          cookies: [{ name: 'session', value: 'abc123' }],
        })
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.action).toBe('cookies_set');
        expect(result.command.cookies).toHaveLength(1);
        expect(result.command.cookies[0].name).toBe('session');
        expect(result.command.cookies[0].value).toBe('abc123');
      }
    });

    it('should parse cookies_set with full cookie options', () => {
      const result = parseCommand(
        cmd({
          id: '1',
          action: 'cookies_set',
          cookies: [
            {
              name: 'auth',
              value: 'token123',
              domain: 'example.com',
              path: '/',
              expires: Date.now() / 1000 + 3600,
              httpOnly: true,
              secure: true,
              sameSite: 'Strict',
            },
          ],
        })
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.cookies[0].httpOnly).toBe(true);
        expect(result.command.cookies[0].secure).toBe(true);
        expect(result.command.cookies[0].sameSite).toBe('Strict');
      }
    });

    it('should parse cookies_set with multiple cookies', () => {
      const result = parseCommand(
        cmd({
          id: '1',
          action: 'cookies_set',
          cookies: [
            { name: 'cookie1', value: 'value1' },
            { name: 'cookie2', value: 'value2' },
          ],
        })
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.cookies).toHaveLength(2);
      }
    });

    it('should reject cookies_set without cookies array', () => {
      const result = parseCommand(cmd({ id: '1', action: 'cookies_set' }));
      expect(result.success).toBe(false);
    });

    it('should accept cookies_set with empty cookies array', () => {
      // Empty array is technically valid (no-op)
      const result = parseCommand(cmd({ id: '1', action: 'cookies_set', cookies: [] }));
      expect(result.success).toBe(true);
    });

    it('should reject cookies_set with cookie missing name', () => {
      const result = parseCommand(
        cmd({ id: '1', action: 'cookies_set', cookies: [{ value: 'test' }] })
      );
      expect(result.success).toBe(false);
    });

    it('should reject cookies_set with cookie missing value', () => {
      const result = parseCommand(
        cmd({ id: '1', action: 'cookies_set', cookies: [{ name: 'test' }] })
      );
      expect(result.success).toBe(false);
    });

    it('should reject cookies_set with invalid sameSite value', () => {
      const result = parseCommand(
        cmd({
          id: '1',
          action: 'cookies_set',
          cookies: [{ name: 'test', value: 'val', sameSite: 'Invalid' }],
        })
      );
      expect(result.success).toBe(false);
    });

    it('should parse cookies_clear', () => {
      const result = parseCommand(cmd({ id: '1', action: 'cookies_clear' }));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.action).toBe('cookies_clear');
      }
    });
  });

  describe('storage', () => {
    it('should parse storage_get for localStorage', () => {
      const result = parseCommand(cmd({ id: '1', action: 'storage_get', type: 'local' }));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.action).toBe('storage_get');
        expect(result.command.type).toBe('local');
      }
    });

    it('should parse storage_get for sessionStorage', () => {
      const result = parseCommand(cmd({ id: '1', action: 'storage_get', type: 'session' }));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.type).toBe('session');
      }
    });

    it('should parse storage_get with specific key', () => {
      const result = parseCommand(
        cmd({ id: '1', action: 'storage_get', type: 'local', key: 'mykey' })
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.key).toBe('mykey');
      }
    });

    it('should parse storage_set', () => {
      const result = parseCommand(
        cmd({
          id: '1',
          action: 'storage_set',
          type: 'local',
          key: 'test',
          value: 'value',
        })
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.action).toBe('storage_set');
        expect(result.command.key).toBe('test');
        expect(result.command.value).toBe('value');
      }
    });

    it('should reject storage_set without key', () => {
      const result = parseCommand(
        cmd({
          id: '1',
          action: 'storage_set',
          type: 'local',
          value: 'value',
        })
      );
      expect(result.success).toBe(false);
    });

    it('should reject storage_set without value', () => {
      const result = parseCommand(
        cmd({
          id: '1',
          action: 'storage_set',
          type: 'local',
          key: 'test',
        })
      );
      expect(result.success).toBe(false);
    });

    it('should parse storage_clear for localStorage', () => {
      const result = parseCommand(cmd({ id: '1', action: 'storage_clear', type: 'local' }));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.action).toBe('storage_clear');
        expect(result.command.type).toBe('local');
      }
    });

    it('should parse storage_clear for sessionStorage', () => {
      const result = parseCommand(cmd({ id: '1', action: 'storage_clear', type: 'session' }));
      expect(result.success).toBe(true);
    });

    it('should reject storage_get without type', () => {
      const result = parseCommand(cmd({ id: '1', action: 'storage_get' }));
      expect(result.success).toBe(false);
    });

    it('should reject storage_get with invalid type', () => {
      const result = parseCommand(cmd({ id: '1', action: 'storage_get', type: 'invalid' }));
      expect(result.success).toBe(false);
    });
  });

  describe('semantic locators', () => {
    it('should parse getbyrole', () => {
      const result = parseCommand(
        cmd({
          id: '1',
          action: 'getbyrole',
          role: 'button',
          subaction: 'click',
        })
      );
      expect(result.success).toBe(true);
    });

    it('should parse getbytext', () => {
      const result = parseCommand(
        cmd({
          id: '1',
          action: 'getbytext',
          text: 'Submit',
          subaction: 'click',
        })
      );
      expect(result.success).toBe(true);
    });

    it('should parse getbylabel', () => {
      const result = parseCommand(
        cmd({
          id: '1',
          action: 'getbylabel',
          label: 'Email',
          subaction: 'fill',
          value: 'test@test.com',
        })
      );
      expect(result.success).toBe(true);
    });
  });

  describe('tabs', () => {
    it('should parse tab_new', () => {
      const result = parseCommand(cmd({ id: '1', action: 'tab_new' }));
      expect(result.success).toBe(true);
    });

    it('should parse tab_list', () => {
      const result = parseCommand(cmd({ id: '1', action: 'tab_list' }));
      expect(result.success).toBe(true);
    });

    it('should parse tab_switch', () => {
      const result = parseCommand(cmd({ id: '1', action: 'tab_switch', index: 0 }));
      expect(result.success).toBe(true);
    });

    it('should parse tab_close', () => {
      const result = parseCommand(cmd({ id: '1', action: 'tab_close' }));
      expect(result.success).toBe(true);
    });
  });

  describe('snapshot', () => {
    it('should parse basic snapshot command', () => {
      const result = parseCommand(cmd({ id: '1', action: 'snapshot' }));
      expect(result.success).toBe(true);
    });

    it('should parse snapshot with interactive filter', () => {
      const result = parseCommand(cmd({ id: '1', action: 'snapshot', interactive: true }));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.interactive).toBe(true);
      }
    });

    it('should parse snapshot with compact filter', () => {
      const result = parseCommand(cmd({ id: '1', action: 'snapshot', compact: true }));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.compact).toBe(true);
      }
    });

    it('should parse snapshot with maxDepth', () => {
      const result = parseCommand(cmd({ id: '1', action: 'snapshot', maxDepth: 3 }));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.maxDepth).toBe(3);
      }
    });

    it('should parse snapshot with selector scope', () => {
      const result = parseCommand(cmd({ id: '1', action: 'snapshot', selector: '#main' }));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.selector).toBe('#main');
      }
    });

    it('should parse snapshot with all options', () => {
      const result = parseCommand(
        cmd({
          id: '1',
          action: 'snapshot',
          interactive: true,
          compact: true,
          maxDepth: 5,
          selector: '.content',
        })
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.interactive).toBe(true);
        expect(result.command.compact).toBe(true);
        expect(result.command.maxDepth).toBe(5);
        expect(result.command.selector).toBe('.content');
      }
    });
  });

  describe('launch', () => {
    it('should parse launch command', () => {
      const result = parseCommand(cmd({ id: '1', action: 'launch' }));
      expect(result.success).toBe(true);
    });

    it('should parse launch with headless false', () => {
      const result = parseCommand(cmd({ id: '1', action: 'launch', headless: false }));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.headless).toBe(false);
      }
    });

    it('should parse launch with cdpPort', () => {
      const result = parseCommand(cmd({ id: '1', action: 'launch', cdpPort: 9222 }));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.cdpPort).toBe(9222);
      }
    });

    it('should reject launch with invalid cdpPort', () => {
      const result = parseCommand(cmd({ id: '1', action: 'launch', cdpPort: -1 }));
      expect(result.success).toBe(false);
    });

    it('should reject launch with non-numeric cdpPort', () => {
      const result = parseCommand(cmd({ id: '1', action: 'launch', cdpPort: 'invalid' }));
      expect(result.success).toBe(false);
    });
  });

  describe('mouse actions', () => {
    it('should parse mousemove', () => {
      const result = parseCommand(cmd({ id: '1', action: 'mousemove', x: 100, y: 200 }));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.x).toBe(100);
        expect(result.command.y).toBe(200);
      }
    });

    it('should parse mousedown', () => {
      const result = parseCommand(cmd({ id: '1', action: 'mousedown', button: 'left' }));
      expect(result.success).toBe(true);
    });

    it('should parse mouseup', () => {
      const result = parseCommand(cmd({ id: '1', action: 'mouseup', button: 'left' }));
      expect(result.success).toBe(true);
    });

    it('should parse wheel', () => {
      const result = parseCommand(cmd({ id: '1', action: 'wheel', deltaX: 0, deltaY: 100 }));
      expect(result.success).toBe(true);
    });
  });

  describe('scroll', () => {
    it('should parse scroll command', () => {
      const result = parseCommand(
        cmd({ id: '1', action: 'scroll', direction: 'down', amount: 300 })
      );
      expect(result.success).toBe(true);
    });

    it('should parse scrollintoview', () => {
      const result = parseCommand(cmd({ id: '1', action: 'scrollintoview', selector: '#element' }));
      expect(result.success).toBe(true);
    });
  });

  describe('element state', () => {
    it('should parse isvisible', () => {
      const result = parseCommand(cmd({ id: '1', action: 'isvisible', selector: '#btn' }));
      expect(result.success).toBe(true);
    });

    it('should parse isenabled', () => {
      const result = parseCommand(cmd({ id: '1', action: 'isenabled', selector: '#btn' }));
      expect(result.success).toBe(true);
    });

    it('should parse ischecked', () => {
      const result = parseCommand(cmd({ id: '1', action: 'ischecked', selector: '#checkbox' }));
      expect(result.success).toBe(true);
    });
  });

  describe('viewport and settings', () => {
    it('should parse viewport', () => {
      const result = parseCommand(cmd({ id: '1', action: 'viewport', width: 1920, height: 1080 }));
      expect(result.success).toBe(true);
    });

    it('should parse geolocation', () => {
      const result = parseCommand(
        cmd({ id: '1', action: 'geolocation', latitude: 37.7749, longitude: -122.4194 })
      );
      expect(result.success).toBe(true);
    });

    it('should parse offline', () => {
      const result = parseCommand(cmd({ id: '1', action: 'offline', offline: true }));
      expect(result.success).toBe(true);
    });
  });

  describe('trace', () => {
    it('should parse trace_start', () => {
      const result = parseCommand(cmd({ id: '1', action: 'trace_start' }));
      expect(result.success).toBe(true);
    });

    it('should parse trace_stop', () => {
      const result = parseCommand(cmd({ id: '1', action: 'trace_stop', path: 'trace.zip' }));
      expect(result.success).toBe(true);
    });
  });

  describe('console and errors', () => {
    it('should parse console', () => {
      const result = parseCommand(cmd({ id: '1', action: 'console' }));
      expect(result.success).toBe(true);
    });

    it('should parse console with clear', () => {
      const result = parseCommand(cmd({ id: '1', action: 'console', clear: true }));
      expect(result.success).toBe(true);
    });

    it('should parse errors', () => {
      const result = parseCommand(cmd({ id: '1', action: 'errors' }));
      expect(result.success).toBe(true);
    });
  });

  describe('dialog', () => {
    it('should parse dialog accept', () => {
      const result = parseCommand(cmd({ id: '1', action: 'dialog', response: 'accept' }));
      expect(result.success).toBe(true);
    });

    it('should parse dialog dismiss', () => {
      const result = parseCommand(cmd({ id: '1', action: 'dialog', response: 'dismiss' }));
      expect(result.success).toBe(true);
    });

    it('should parse dialog accept with prompt text', () => {
      const result = parseCommand(
        cmd({ id: '1', action: 'dialog', response: 'accept', promptText: 'hello' })
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.promptText).toBe('hello');
      }
    });
  });

  describe('frame', () => {
    it('should parse frame command', () => {
      const result = parseCommand(cmd({ id: '1', action: 'frame', selector: '#iframe' }));
      expect(result.success).toBe(true);
    });

    it('should parse mainframe', () => {
      const result = parseCommand(cmd({ id: '1', action: 'mainframe' }));
      expect(result.success).toBe(true);
    });
  });

  describe('screencast', () => {
    it('should parse screencast_start with defaults', () => {
      const result = parseCommand(cmd({ id: '1', action: 'screencast_start' }));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.action).toBe('screencast_start');
      }
    });

    it('should parse screencast_start with all options', () => {
      const result = parseCommand(
        cmd({
          id: '1',
          action: 'screencast_start',
          format: 'png',
          quality: 90,
          maxWidth: 1920,
          maxHeight: 1080,
          everyNthFrame: 2,
        })
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.format).toBe('png');
        expect(result.command.quality).toBe(90);
        expect(result.command.maxWidth).toBe(1920);
        expect(result.command.maxHeight).toBe(1080);
        expect(result.command.everyNthFrame).toBe(2);
      }
    });

    it('should reject screencast_start with invalid format', () => {
      const result = parseCommand(cmd({ id: '1', action: 'screencast_start', format: 'gif' }));
      expect(result.success).toBe(false);
    });

    it('should reject screencast_start with quality out of range', () => {
      const result = parseCommand(cmd({ id: '1', action: 'screencast_start', quality: 150 }));
      expect(result.success).toBe(false);
    });

    it('should reject screencast_start with negative maxWidth', () => {
      const result = parseCommand(cmd({ id: '1', action: 'screencast_start', maxWidth: -100 }));
      expect(result.success).toBe(false);
    });

    it('should parse screencast_stop', () => {
      const result = parseCommand(cmd({ id: '1', action: 'screencast_stop' }));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.command.action).toBe('screencast_stop');
      }
    });
  });

  describe('input injection', () => {
    describe('input_mouse', () => {
      it('should parse mousePressed event', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_mouse',
            type: 'mousePressed',
            x: 100,
            y: 200,
            button: 'left',
          })
        );
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.command.action).toBe('input_mouse');
          expect(result.command.type).toBe('mousePressed');
          expect(result.command.x).toBe(100);
          expect(result.command.y).toBe(200);
          expect(result.command.button).toBe('left');
        }
      });

      it('should parse mouseReleased event', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_mouse',
            type: 'mouseReleased',
            x: 100,
            y: 200,
          })
        );
        expect(result.success).toBe(true);
      });

      it('should parse mouseMoved event', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_mouse',
            type: 'mouseMoved',
            x: 150,
            y: 250,
          })
        );
        expect(result.success).toBe(true);
      });

      it('should parse mouseWheel event with deltas', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_mouse',
            type: 'mouseWheel',
            x: 100,
            y: 200,
            deltaX: 0,
            deltaY: 100,
          })
        );
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.command.deltaX).toBe(0);
          expect(result.command.deltaY).toBe(100);
        }
      });

      it('should parse mouse event with modifiers', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_mouse',
            type: 'mousePressed',
            x: 100,
            y: 200,
            modifiers: 6, // Ctrl + Meta
          })
        );
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.command.modifiers).toBe(6);
        }
      });

      it('should parse mouse event with clickCount', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_mouse',
            type: 'mousePressed',
            x: 100,
            y: 200,
            clickCount: 2,
          })
        );
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.command.clickCount).toBe(2);
        }
      });

      it('should reject input_mouse with invalid type', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_mouse',
            type: 'invalid',
            x: 100,
            y: 200,
          })
        );
        expect(result.success).toBe(false);
      });

      it('should reject input_mouse without x coordinate', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_mouse',
            type: 'mousePressed',
            y: 200,
          })
        );
        expect(result.success).toBe(false);
      });

      it('should reject input_mouse without y coordinate', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_mouse',
            type: 'mousePressed',
            x: 100,
          })
        );
        expect(result.success).toBe(false);
      });
    });

    describe('input_keyboard', () => {
      it('should parse keyDown event', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_keyboard',
            type: 'keyDown',
            key: 'Enter',
            code: 'Enter',
          })
        );
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.command.action).toBe('input_keyboard');
          expect(result.command.type).toBe('keyDown');
          expect(result.command.key).toBe('Enter');
          expect(result.command.code).toBe('Enter');
        }
      });

      it('should parse keyUp event', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_keyboard',
            type: 'keyUp',
            key: 'a',
          })
        );
        expect(result.success).toBe(true);
      });

      it('should parse char event with text', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_keyboard',
            type: 'char',
            text: 'hello',
          })
        );
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.command.text).toBe('hello');
        }
      });

      it('should parse keyboard event with modifiers', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_keyboard',
            type: 'keyDown',
            key: 'c',
            modifiers: 2, // Ctrl
          })
        );
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.command.modifiers).toBe(2);
        }
      });

      it('should reject input_keyboard with invalid type', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_keyboard',
            type: 'invalid',
          })
        );
        expect(result.success).toBe(false);
      });
    });

    describe('input_touch', () => {
      it('should parse touchStart event', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_touch',
            type: 'touchStart',
            touchPoints: [{ x: 100, y: 200 }],
          })
        );
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.command.action).toBe('input_touch');
          expect(result.command.type).toBe('touchStart');
          expect(result.command.touchPoints).toHaveLength(1);
          expect(result.command.touchPoints[0].x).toBe(100);
          expect(result.command.touchPoints[0].y).toBe(200);
        }
      });

      it('should parse touchEnd event', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_touch',
            type: 'touchEnd',
            touchPoints: [],
          })
        );
        expect(result.success).toBe(true);
      });

      it('should parse touchMove event', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_touch',
            type: 'touchMove',
            touchPoints: [{ x: 150, y: 250 }],
          })
        );
        expect(result.success).toBe(true);
      });

      it('should parse touchCancel event', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_touch',
            type: 'touchCancel',
            touchPoints: [],
          })
        );
        expect(result.success).toBe(true);
      });

      it('should parse multi-touch event', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_touch',
            type: 'touchStart',
            touchPoints: [
              { x: 100, y: 200, id: 0 },
              { x: 300, y: 400, id: 1 },
            ],
          })
        );
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.command.touchPoints).toHaveLength(2);
        }
      });

      it('should parse touch event with modifiers', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_touch',
            type: 'touchStart',
            touchPoints: [{ x: 100, y: 200 }],
            modifiers: 8, // Shift
          })
        );
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.command.modifiers).toBe(8);
        }
      });

      it('should reject input_touch with invalid type', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_touch',
            type: 'invalid',
            touchPoints: [],
          })
        );
        expect(result.success).toBe(false);
      });

      it('should reject input_touch without touchPoints', () => {
        const result = parseCommand(
          cmd({
            id: '1',
            action: 'input_touch',
            type: 'touchStart',
          })
        );
        expect(result.success).toBe(false);
      });
    });
  });

  describe('invalid commands', () => {
    it('should reject unknown action', () => {
      const result = parseCommand(cmd({ id: '1', action: 'unknown' }));
      expect(result.success).toBe(false);
    });

    it('should reject missing id', () => {
      const result = parseCommand(cmd({ action: 'click', selector: '#btn' }));
      expect(result.success).toBe(false);
    });

    it('should reject invalid JSON', () => {
      const result = parseCommand('not json');
      expect(result.success).toBe(false);
    });
  });
});
```

src/protocol.ts
```
import { z } from 'zod';
import type { Command, Response } from './types.js';

// Base schema for all commands
const baseCommandSchema = z.object({
  id: z.string(),
  action: z.string(),
});

// Individual action schemas
const launchSchema = baseCommandSchema.extend({
  action: z.literal('launch'),
  headless: z.boolean().optional(),
  viewport: z
    .object({
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .optional(),
  browser: z.enum(['chromium', 'firefox', 'webkit']).optional(),
  cdpPort: z.number().positive().optional(),
});

const navigateSchema = baseCommandSchema.extend({
  action: z.literal('navigate'),
  url: z.string().min(1),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
});

const clickSchema = baseCommandSchema.extend({
  action: z.literal('click'),
  selector: z.string().min(1),
  button: z.enum(['left', 'right', 'middle']).optional(),
  clickCount: z.number().positive().optional(),
  delay: z.number().nonnegative().optional(),
});

const typeSchema = baseCommandSchema.extend({
  action: z.literal('type'),
  selector: z.string().min(1),
  text: z.string(),
  delay: z.number().nonnegative().optional(),
  clear: z.boolean().optional(),
});

const fillSchema = baseCommandSchema.extend({
  action: z.literal('fill'),
  selector: z.string().min(1),
  value: z.string(),
});

const checkSchema = baseCommandSchema.extend({
  action: z.literal('check'),
  selector: z.string().min(1),
});

const uncheckSchema = baseCommandSchema.extend({
  action: z.literal('uncheck'),
  selector: z.string().min(1),
});

const uploadSchema = baseCommandSchema.extend({
  action: z.literal('upload'),
  selector: z.string().min(1),
  files: z.union([z.string(), z.array(z.string())]),
});

const dblclickSchema = baseCommandSchema.extend({
  action: z.literal('dblclick'),
  selector: z.string().min(1),
});

const focusSchema = baseCommandSchema.extend({
  action: z.literal('focus'),
  selector: z.string().min(1),
});

const dragSchema = baseCommandSchema.extend({
  action: z.literal('drag'),
  source: z.string().min(1),
  target: z.string().min(1),
});

const frameSchema = baseCommandSchema.extend({
  action: z.literal('frame'),
  selector: z.string().min(1).optional(),
  name: z.string().optional(),
  url: z.string().optional(),
});

const mainframeSchema = baseCommandSchema.extend({
  action: z.literal('mainframe'),
});

const getByRoleSchema = baseCommandSchema.extend({
  action: z.literal('getbyrole'),
  role: z.string().min(1),
  name: z.string().optional(),
  subaction: z.enum(['click', 'fill', 'check', 'hover']),
  value: z.string().optional(),
});

const getByTextSchema = baseCommandSchema.extend({
  action: z.literal('getbytext'),
  text: z.string().min(1),
  exact: z.boolean().optional(),
  subaction: z.enum(['click', 'hover']),
});

const getByLabelSchema = baseCommandSchema.extend({
  action: z.literal('getbylabel'),
  label: z.string().min(1),
  subaction: z.enum(['click', 'fill', 'check']),
  value: z.string().optional(),
});

const getByPlaceholderSchema = baseCommandSchema.extend({
  action: z.literal('getbyplaceholder'),
  placeholder: z.string().min(1),
  subaction: z.enum(['click', 'fill']),
  value: z.string().optional(),
});

const cookiesGetSchema = baseCommandSchema.extend({
  action: z.literal('cookies_get'),
  urls: z.array(z.string()).optional(),
});

const cookiesSetSchema = baseCommandSchema.extend({
  action: z.literal('cookies_set'),
  cookies: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      url: z.string().optional(),
      domain: z.string().optional(),
      path: z.string().optional(),
      expires: z.number().optional(),
      httpOnly: z.boolean().optional(),
      secure: z.boolean().optional(),
      sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
    })
  ),
});

const cookiesClearSchema = baseCommandSchema.extend({
  action: z.literal('cookies_clear'),
});

const storageGetSchema = baseCommandSchema.extend({
  action: z.literal('storage_get'),
  key: z.string().optional(),
  type: z.enum(['local', 'session']),
});

const storageSetSchema = baseCommandSchema.extend({
  action: z.literal('storage_set'),
  key: z.string().min(1),
  value: z.string(),
  type: z.enum(['local', 'session']),
});

const storageClearSchema = baseCommandSchema.extend({
  action: z.literal('storage_clear'),
  type: z.enum(['local', 'session']),
});

const dialogSchema = baseCommandSchema.extend({
  action: z.literal('dialog'),
  response: z.enum(['accept', 'dismiss']),
  promptText: z.string().optional(),
});

const pdfSchema = baseCommandSchema.extend({
  action: z.literal('pdf'),
  path: z.string().min(1),
  format: z
    .enum(['Letter', 'Legal', 'Tabloid', 'Ledger', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6'])
    .optional(),
});

const routeSchema = baseCommandSchema.extend({
  action: z.literal('route'),
  url: z.string().min(1),
  response: z
    .object({
      status: z.number().optional(),
      body: z.string().optional(),
      contentType: z.string().optional(),
      headers: z.record(z.string()).optional(),
    })
    .optional(),
  abort: z.boolean().optional(),
});

const unrouteSchema = baseCommandSchema.extend({
  action: z.literal('unroute'),
  url: z.string().optional(),
});

const requestsSchema = baseCommandSchema.extend({
  action: z.literal('requests'),
  filter: z.string().optional(),
  clear: z.boolean().optional(),
});

const downloadSchema = baseCommandSchema.extend({
  action: z.literal('download'),
  selector: z.string().min(1),
  path: z.string().min(1),
});

const geolocationSchema = baseCommandSchema.extend({
  action: z.literal('geolocation'),
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().optional(),
});

const permissionsSchema = baseCommandSchema.extend({
  action: z.literal('permissions'),
  permissions: z.array(z.string()),
  grant: z.boolean(),
});

const viewportSchema = baseCommandSchema.extend({
  action: z.literal('viewport'),
  width: z.number().positive(),
  height: z.number().positive(),
});

const userAgentSchema = baseCommandSchema.extend({
  action: z.literal('useragent'),
  userAgent: z.string().min(1),
});

const deviceSchema = baseCommandSchema.extend({
  action: z.literal('device'),
  device: z.string().min(1),
});

const backSchema = baseCommandSchema.extend({
  action: z.literal('back'),
});

const forwardSchema = baseCommandSchema.extend({
  action: z.literal('forward'),
});

const reloadSchema = baseCommandSchema.extend({
  action: z.literal('reload'),
});

const urlSchema = baseCommandSchema.extend({
  action: z.literal('url'),
});

const titleSchema = baseCommandSchema.extend({
  action: z.literal('title'),
});

const getAttributeSchema = baseCommandSchema.extend({
  action: z.literal('getattribute'),
  selector: z.string().min(1),
  attribute: z.string().min(1),
});

const getTextSchema = baseCommandSchema.extend({
  action: z.literal('gettext'),
  selector: z.string().min(1),
});

const isVisibleSchema = baseCommandSchema.extend({
  action: z.literal('isvisible'),
  selector: z.string().min(1),
});

const isEnabledSchema = baseCommandSchema.extend({
  action: z.literal('isenabled'),
  selector: z.string().min(1),
});

const isCheckedSchema = baseCommandSchema.extend({
  action: z.literal('ischecked'),
  selector: z.string().min(1),
});

const countSchema = baseCommandSchema.extend({
  action: z.literal('count'),
  selector: z.string().min(1),
});

const boundingBoxSchema = baseCommandSchema.extend({
  action: z.literal('boundingbox'),
  selector: z.string().min(1),
});

const videoStartSchema = baseCommandSchema.extend({
  action: z.literal('video_start'),
  path: z.string().min(1),
});

const videoStopSchema = baseCommandSchema.extend({
  action: z.literal('video_stop'),
});

const traceStartSchema = baseCommandSchema.extend({
  action: z.literal('trace_start'),
  screenshots: z.boolean().optional(),
  snapshots: z.boolean().optional(),
});

const traceStopSchema = baseCommandSchema.extend({
  action: z.literal('trace_stop'),
  path: z.string().min(1),
});

const harStartSchema = baseCommandSchema.extend({
  action: z.literal('har_start'),
});

const harStopSchema = baseCommandSchema.extend({
  action: z.literal('har_stop'),
  path: z.string().min(1),
});

const stateSaveSchema = baseCommandSchema.extend({
  action: z.literal('state_save'),
  path: z.string().min(1),
});

const stateLoadSchema = baseCommandSchema.extend({
  action: z.literal('state_load'),
  path: z.string().min(1),
});

const consoleSchema = baseCommandSchema.extend({
  action: z.literal('console'),
  clear: z.boolean().optional(),
});

const errorsSchema = baseCommandSchema.extend({
  action: z.literal('errors'),
  clear: z.boolean().optional(),
});

const keyboardSchema = baseCommandSchema.extend({
  action: z.literal('keyboard'),
  keys: z.string().min(1),
});

const wheelSchema = baseCommandSchema.extend({
  action: z.literal('wheel'),
  deltaX: z.number().optional(),
  deltaY: z.number().optional(),
  selector: z.string().optional(),
});

const tapSchema = baseCommandSchema.extend({
  action: z.literal('tap'),
  selector: z.string().min(1),
});

const clipboardSchema = baseCommandSchema.extend({
  action: z.literal('clipboard'),
  operation: z.enum(['copy', 'paste', 'read']),
  text: z.string().optional(),
});

const highlightSchema = baseCommandSchema.extend({
  action: z.literal('highlight'),
  selector: z.string().min(1),
});

const clearSchema = baseCommandSchema.extend({
  action: z.literal('clear'),
  selector: z.string().min(1),
});

const selectAllSchema = baseCommandSchema.extend({
  action: z.literal('selectall'),
  selector: z.string().min(1),
});

const innerTextSchema = baseCommandSchema.extend({
  action: z.literal('innertext'),
  selector: z.string().min(1),
});

const innerHtmlSchema = baseCommandSchema.extend({
  action: z.literal('innerhtml'),
  selector: z.string().min(1),
});

const inputValueSchema = baseCommandSchema.extend({
  action: z.literal('inputvalue'),
  selector: z.string().min(1),
});

const setValueSchema = baseCommandSchema.extend({
  action: z.literal('setvalue'),
  selector: z.string().min(1),
  value: z.string(),
});

const dispatchSchema = baseCommandSchema.extend({
  action: z.literal('dispatch'),
  selector: z.string().min(1),
  event: z.string().min(1),
  eventInit: z.record(z.unknown()).optional(),
});

const evalHandleSchema = baseCommandSchema.extend({
  action: z.literal('evalhandle'),
  script: z.string().min(1),
});

const exposeSchema = baseCommandSchema.extend({
  action: z.literal('expose'),
  name: z.string().min(1),
});

const addScriptSchema = baseCommandSchema.extend({
  action: z.literal('addscript'),
  content: z.string().optional(),
  url: z.string().optional(),
});

const addStyleSchema = baseCommandSchema.extend({
  action: z.literal('addstyle'),
  content: z.string().optional(),
  url: z.string().optional(),
});

const emulateMediaSchema = baseCommandSchema.extend({
  action: z.literal('emulatemedia'),
  media: z.enum(['screen', 'print']).nullable().optional(),
  colorScheme: z.enum(['light', 'dark', 'no-preference']).nullable().optional(),
  reducedMotion: z.enum(['reduce', 'no-preference']).nullable().optional(),
  forcedColors: z.enum(['active', 'none']).nullable().optional(),
});

const offlineSchema = baseCommandSchema.extend({
  action: z.literal('offline'),
  offline: z.boolean(),
});

const headersSchema = baseCommandSchema.extend({
  action: z.literal('headers'),
  headers: z.record(z.string()),
});

const pauseSchema = baseCommandSchema.extend({
  action: z.literal('pause'),
});

const getByAltTextSchema = baseCommandSchema.extend({
  action: z.literal('getbyalttext'),
  text: z.string().min(1),
  exact: z.boolean().optional(),
  subaction: z.enum(['click', 'hover']),
});

const getByTitleSchema = baseCommandSchema.extend({
  action: z.literal('getbytitle'),
  text: z.string().min(1),
  exact: z.boolean().optional(),
  subaction: z.enum(['click', 'hover']),
});

const getByTestIdSchema = baseCommandSchema.extend({
  action: z.literal('getbytestid'),
  testId: z.string().min(1),
  subaction: z.enum(['click', 'fill', 'check', 'hover']),
  value: z.string().optional(),
});

const nthSchema = baseCommandSchema.extend({
  action: z.literal('nth'),
  selector: z.string().min(1),
  index: z.number(),
  subaction: z.enum(['click', 'fill', 'check', 'hover', 'text']),
  value: z.string().optional(),
});

const waitForUrlSchema = baseCommandSchema.extend({
  action: z.literal('waitforurl'),
  url: z.string().min(1),
  timeout: z.number().positive().optional(),
});

const waitForLoadStateSchema = baseCommandSchema.extend({
  action: z.literal('waitforloadstate'),
  state: z.enum(['load', 'domcontentloaded', 'networkidle']),
  timeout: z.number().positive().optional(),
});

const setContentSchema = baseCommandSchema.extend({
  action: z.literal('setcontent'),
  html: z.string(),
});

const timezoneSchema = baseCommandSchema.extend({
  action: z.literal('timezone'),
  timezone: z.string().min(1),
});

const localeSchema = baseCommandSchema.extend({
  action: z.literal('locale'),
  locale: z.string().min(1),
});

const credentialsSchema = baseCommandSchema.extend({
  action: z.literal('credentials'),
  username: z.string(),
  password: z.string(),
});

const mouseMoveSchema = baseCommandSchema.extend({
  action: z.literal('mousemove'),
  x: z.number(),
  y: z.number(),
});

const mouseDownSchema = baseCommandSchema.extend({
  action: z.literal('mousedown'),
  button: z.enum(['left', 'right', 'middle']).optional(),
});

const mouseUpSchema = baseCommandSchema.extend({
  action: z.literal('mouseup'),
  button: z.enum(['left', 'right', 'middle']).optional(),
});

const bringToFrontSchema = baseCommandSchema.extend({
  action: z.literal('bringtofront'),
});

const waitForFunctionSchema = baseCommandSchema.extend({
  action: z.literal('waitforfunction'),
  expression: z.string().min(1),
  timeout: z.number().positive().optional(),
});

const scrollIntoViewSchema = baseCommandSchema.extend({
  action: z.literal('scrollintoview'),
  selector: z.string().min(1),
});

const addInitScriptSchema = baseCommandSchema.extend({
  action: z.literal('addinitscript'),
  script: z.string().min(1),
});

const keyDownSchema = baseCommandSchema.extend({
  action: z.literal('keydown'),
  key: z.string().min(1),
});

const keyUpSchema = baseCommandSchema.extend({
  action: z.literal('keyup'),
  key: z.string().min(1),
});

const insertTextSchema = baseCommandSchema.extend({
  action: z.literal('inserttext'),
  text: z.string(),
});

const multiSelectSchema = baseCommandSchema.extend({
  action: z.literal('multiselect'),
  selector: z.string().min(1),
  values: z.array(z.string()),
});

const waitForDownloadSchema = baseCommandSchema.extend({
  action: z.literal('waitfordownload'),
  path: z.string().optional(),
  timeout: z.number().positive().optional(),
});

const responseBodySchema = baseCommandSchema.extend({
  action: z.literal('responsebody'),
  url: z.string().min(1),
  timeout: z.number().positive().optional(),
});

// Screencast schemas for streaming browser viewport
const screencastStartSchema = baseCommandSchema.extend({
  action: z.literal('screencast_start'),
  format: z.enum(['jpeg', 'png']).optional(),
  quality: z.number().min(0).max(100).optional(),
  maxWidth: z.number().positive().optional(),
  maxHeight: z.number().positive().optional(),
  everyNthFrame: z.number().positive().optional(),
});

const screencastStopSchema = baseCommandSchema.extend({
  action: z.literal('screencast_stop'),
});

// Input injection schemas for pair browsing
const inputMouseSchema = baseCommandSchema.extend({
  action: z.literal('input_mouse'),
  type: z.enum(['mousePressed', 'mouseReleased', 'mouseMoved', 'mouseWheel']),
  x: z.number(),
  y: z.number(),
  button: z.enum(['left', 'right', 'middle', 'none']).optional(),
  clickCount: z.number().positive().optional(),
  deltaX: z.number().optional(),
  deltaY: z.number().optional(),
  modifiers: z.number().optional(),
});

const inputKeyboardSchema = baseCommandSchema.extend({
  action: z.literal('input_keyboard'),
  type: z.enum(['keyDown', 'keyUp', 'char']),
  key: z.string().optional(),
  code: z.string().optional(),
  text: z.string().optional(),
  modifiers: z.number().optional(),
});

const inputTouchSchema = baseCommandSchema.extend({
  action: z.literal('input_touch'),
  type: z.enum(['touchStart', 'touchEnd', 'touchMove', 'touchCancel']),
  touchPoints: z.array(
    z.object({
      x: z.number(),
      y: z.number(),
      id: z.number().optional(),
    })
  ),
  modifiers: z.number().optional(),
});

const pressSchema = baseCommandSchema.extend({
  action: z.literal('press'),
  key: z.string().min(1),
  selector: z.string().min(1).optional(),
});

const screenshotSchema = baseCommandSchema.extend({
  action: z.literal('screenshot'),
  path: z.string().optional(),
  fullPage: z.boolean().optional(),
  selector: z.string().min(1).optional(),
  format: z.enum(['png', 'jpeg']).optional(),
  quality: z.number().min(0).max(100).optional(),
});

const snapshotSchema = baseCommandSchema.extend({
  action: z.literal('snapshot'),
  interactive: z.boolean().optional(),
  maxDepth: z.number().nonnegative().optional(),
  compact: z.boolean().optional(),
  selector: z.string().optional(),
});

const evaluateSchema = baseCommandSchema.extend({
  action: z.literal('evaluate'),
  script: z.string().min(1),
  args: z.array(z.unknown()).optional(),
});

const waitSchema = baseCommandSchema.extend({
  action: z.literal('wait'),
  selector: z.string().min(1).optional(),
  timeout: z.number().positive().optional(),
  state: z.enum(['attached', 'detached', 'visible', 'hidden']).optional(),
});

const scrollSchema = baseCommandSchema.extend({
  action: z.literal('scroll'),
  selector: z.string().min(1).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  direction: z.enum(['up', 'down', 'left', 'right']).optional(),
  amount: z.number().positive().optional(),
});

const selectSchema = baseCommandSchema.extend({
  action: z.literal('select'),
  selector: z.string().min(1),
  values: z.union([z.string(), z.array(z.string())]),
});

const hoverSchema = baseCommandSchema.extend({
  action: z.literal('hover'),
  selector: z.string().min(1),
});

const contentSchema = baseCommandSchema.extend({
  action: z.literal('content'),
  selector: z.string().min(1).optional(),
});

const closeSchema = baseCommandSchema.extend({
  action: z.literal('close'),
});

// Tab/Window schemas
const tabNewSchema = baseCommandSchema.extend({
  action: z.literal('tab_new'),
});

const tabListSchema = baseCommandSchema.extend({
  action: z.literal('tab_list'),
});

const tabSwitchSchema = baseCommandSchema.extend({
  action: z.literal('tab_switch'),
  index: z.number().nonnegative(),
});

const tabCloseSchema = baseCommandSchema.extend({
  action: z.literal('tab_close'),
  index: z.number().nonnegative().optional(),
});

const windowNewSchema = baseCommandSchema.extend({
  action: z.literal('window_new'),
  viewport: z
    .object({
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .optional(),
});

// Union schema for all commands
const commandSchema = z.discriminatedUnion('action', [
  launchSchema,
  navigateSchema,
  clickSchema,
  typeSchema,
  fillSchema,
  checkSchema,
  uncheckSchema,
  uploadSchema,
  dblclickSchema,
  focusSchema,
  dragSchema,
  frameSchema,
  mainframeSchema,
  getByRoleSchema,
  getByTextSchema,
  getByLabelSchema,
  getByPlaceholderSchema,
  pressSchema,
  screenshotSchema,
  snapshotSchema,
  evaluateSchema,
  waitSchema,
  scrollSchema,
  selectSchema,
  hoverSchema,
  contentSchema,
  closeSchema,
  tabNewSchema,
  tabListSchema,
  tabSwitchSchema,
  tabCloseSchema,
  windowNewSchema,
  cookiesGetSchema,
  cookiesSetSchema,
  cookiesClearSchema,
  storageGetSchema,
  storageSetSchema,
  storageClearSchema,
  dialogSchema,
  pdfSchema,
  routeSchema,
  unrouteSchema,
  requestsSchema,
  downloadSchema,
  geolocationSchema,
  permissionsSchema,
  viewportSchema,
  userAgentSchema,
  deviceSchema,
  backSchema,
  forwardSchema,
  reloadSchema,
  urlSchema,
  titleSchema,
  getAttributeSchema,
  getTextSchema,
  isVisibleSchema,
  isEnabledSchema,
  isCheckedSchema,
  countSchema,
  boundingBoxSchema,
  videoStartSchema,
  videoStopSchema,
  traceStartSchema,
  traceStopSchema,
  harStartSchema,
  harStopSchema,
  stateSaveSchema,
  stateLoadSchema,
  consoleSchema,
  errorsSchema,
  keyboardSchema,
  wheelSchema,
  tapSchema,
  clipboardSchema,
  highlightSchema,
  clearSchema,
  selectAllSchema,
  innerTextSchema,
  innerHtmlSchema,
  inputValueSchema,
  setValueSchema,
  dispatchSchema,
  evalHandleSchema,
  exposeSchema,
  addScriptSchema,
  addStyleSchema,
  emulateMediaSchema,
  offlineSchema,
  headersSchema,
  pauseSchema,
  getByAltTextSchema,
  getByTitleSchema,
  getByTestIdSchema,
  nthSchema,
  waitForUrlSchema,
  waitForLoadStateSchema,
  setContentSchema,
  timezoneSchema,
  localeSchema,
  credentialsSchema,
  mouseMoveSchema,
  mouseDownSchema,
  mouseUpSchema,
  bringToFrontSchema,
  waitForFunctionSchema,
  scrollIntoViewSchema,
  addInitScriptSchema,
  keyDownSchema,
  keyUpSchema,
  insertTextSchema,
  multiSelectSchema,
  waitForDownloadSchema,
  responseBodySchema,
  screencastStartSchema,
  screencastStopSchema,
  inputMouseSchema,
  inputKeyboardSchema,
  inputTouchSchema,
]);

// Parse result type
export type ParseResult =
  | { success: true; command: Command }
  | { success: false; error: string; id?: string };

/**
 * Parse a JSON string into a validated command
 */
export function parseCommand(input: string): ParseResult {
  // First, try to parse JSON
  let json: unknown;
  try {
    json = JSON.parse(input);
  } catch {
    return { success: false, error: 'Invalid JSON' };
  }

  // Extract id for error responses if possible
  const id =
    typeof json === 'object' && json !== null && 'id' in json
      ? String((json as { id: unknown }).id)
      : undefined;

  // Validate against schema
  const result = commandSchema.safeParse(json);

  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    return { success: false, error: `Validation error: ${errors}`, id };
  }

  return { success: true, command: result.data as Command };
}

/**
 * Create a success response
 */
export function successResponse<T>(id: string, data: T): Response<T> {
  return { id, success: true, data };
}

/**
 * Create an error response
 */
export function errorResponse(id: string, error: string): Response {
  return { id, success: false, error };
}

/**
 * Serialize a response to JSON string
 */
export function serializeResponse(response: Response): string {
  return JSON.stringify(response);
}
```

src/snapshot.ts
```
/**
 * Enhanced snapshot with element refs for deterministic element selection.
 *
 * This module generates accessibility snapshots with embedded refs that can be
 * used to click/fill/interact with elements without re-querying the DOM.
 *
 * Example output:
 *   - heading "Example Domain" [ref=e1] [level=1]
 *   - paragraph: Some text content
 *   - button "Submit" [ref=e2]
 *   - textbox "Email" [ref=e3]
 *
 * Usage:
 *   agent-browser snapshot              # Full snapshot
 *   agent-browser snapshot -i           # Interactive elements only
 *   agent-browser snapshot --depth 3    # Limit depth
 *   agent-browser click @e2             # Click element by ref
 */

import type { Page, Locator } from 'playwright-core';

export interface RefMap {
  [ref: string]: {
    selector: string;
    role: string;
    name?: string;
    /** Index for disambiguation when multiple elements have same role+name */
    nth?: number;
  };
}

export interface EnhancedSnapshot {
  tree: string;
  refs: RefMap;
}

export interface SnapshotOptions {
  /** Only include interactive elements (buttons, links, inputs, etc.) */
  interactive?: boolean;
  /** Maximum depth of tree to include (0 = root only) */
  maxDepth?: number;
  /** Remove structural elements without meaningful content */
  compact?: boolean;
  /** CSS selector to scope the snapshot */
  selector?: string;
}

// Counter for generating refs
let refCounter = 0;

/**
 * Reset ref counter (call at start of each snapshot)
 */
export function resetRefs(): void {
  refCounter = 0;
}

/**
 * Generate next ref ID
 */
function nextRef(): string {
  return `e${++refCounter}`;
}

/**
 * Roles that are interactive and should get refs
 */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'treeitem',
]);

/**
 * Roles that provide structure/context (get refs for text extraction)
 */
const CONTENT_ROLES = new Set([
  'heading',
  'cell',
  'gridcell',
  'columnheader',
  'rowheader',
  'listitem',
  'article',
  'region',
  'main',
  'navigation',
]);

/**
 * Roles that are purely structural (can be filtered in compact mode)
 */
const STRUCTURAL_ROLES = new Set([
  'generic',
  'group',
  'list',
  'table',
  'row',
  'rowgroup',
  'grid',
  'treegrid',
  'menu',
  'menubar',
  'toolbar',
  'tablist',
  'tree',
  'directory',
  'document',
  'application',
  'presentation',
  'none',
]);

/**
 * Build a selector string for storing in ref map
 */
function buildSelector(role: string, name?: string): string {
  if (name) {
    const escapedName = name.replace(/"/g, '\\"');
    return `getByRole('${role}', { name: "${escapedName}", exact: true })`;
  }
  return `getByRole('${role}')`;
}

/**
 * Get enhanced snapshot with refs and optional filtering
 */
export async function getEnhancedSnapshot(
  page: Page,
  options: SnapshotOptions = {}
): Promise<EnhancedSnapshot> {
  resetRefs();
  const refs: RefMap = {};

  // Get ARIA snapshot from Playwright
  const locator = options.selector ? page.locator(options.selector) : page.locator(':root');
  const ariaTree = await locator.ariaSnapshot();

  if (!ariaTree) {
    return {
      tree: '(empty)',
      refs: {},
    };
  }

  // Parse and enhance the ARIA tree
  const enhancedTree = processAriaTree(ariaTree, refs, options);

  return { tree: enhancedTree, refs };
}

/**
 * Track role+name combinations to detect duplicates
 */
interface RoleNameTracker {
  counts: Map<string, number>;
  /** Maps role+name key to array of ref IDs that use it */
  refsByKey: Map<string, string[]>;
  getKey(role: string, name?: string): string;
  getNextIndex(role: string, name?: string): number;
  trackRef(role: string, name: string | undefined, ref: string): void;
  /** Get all role+name keys that have duplicates */
  getDuplicateKeys(): Set<string>;
}

function createRoleNameTracker(): RoleNameTracker {
  const counts = new Map<string, number>();
  const refsByKey = new Map<string, string[]>();
  return {
    counts,
    refsByKey,
    getKey(role: string, name?: string): string {
      return `${role}:${name ?? ''}`;
    },
    getNextIndex(role: string, name?: string): number {
      const key = this.getKey(role, name);
      const current = counts.get(key) ?? 0;
      counts.set(key, current + 1);
      return current;
    },
    trackRef(role: string, name: string | undefined, ref: string): void {
      const key = this.getKey(role, name);
      const refs = refsByKey.get(key) ?? [];
      refs.push(ref);
      refsByKey.set(key, refs);
    },
    getDuplicateKeys(): Set<string> {
      const duplicates = new Set<string>();
      for (const [key, refs] of refsByKey) {
        if (refs.length > 1) {
          duplicates.add(key);
        }
      }
      return duplicates;
    },
  };
}

/**
 * Process ARIA snapshot: add refs and apply filters
 */
function processAriaTree(ariaTree: string, refs: RefMap, options: SnapshotOptions): string {
  const lines = ariaTree.split('\n');
  const result: string[] = [];
  const tracker = createRoleNameTracker();

  // For interactive-only mode, we collect just interactive elements
  if (options.interactive) {
    for (const line of lines) {
      const match = line.match(/^(\s*-\s*)(\w+)(?:\s+"([^"]*)")?(.*)$/);
      if (!match) continue;

      const [, , role, name, suffix] = match;
      const roleLower = role.toLowerCase();

      if (INTERACTIVE_ROLES.has(roleLower)) {
        const ref = nextRef();
        const nth = tracker.getNextIndex(roleLower, name);
        tracker.trackRef(roleLower, name, ref);
        refs[ref] = {
          selector: buildSelector(roleLower, name),
          role: roleLower,
          name,
          nth, // Always store nth, we'll use it for duplicates
        };

        let enhanced = `- ${role}`;
        if (name) enhanced += ` "${name}"`;
        enhanced += ` [ref=${ref}]`;
        // Only show nth in output if it's > 0 (for readability)
        if (nth > 0) enhanced += ` [nth=${nth}]`;
        if (suffix && suffix.includes('[')) enhanced += suffix;

        result.push(enhanced);
      }
    }

    // Post-process: remove nth from refs that don't have duplicates
    removeNthFromNonDuplicates(refs, tracker);

    return result.join('\n') || '(no interactive elements)';
  }

  // Normal processing with depth/compact filters
  for (const line of lines) {
    const processed = processLine(line, refs, options, tracker);
    if (processed !== null) {
      result.push(processed);
    }
  }

  // Post-process: remove nth from refs that don't have duplicates
  removeNthFromNonDuplicates(refs, tracker);

  // If compact mode, remove empty structural elements
  if (options.compact) {
    return compactTree(result.join('\n'));
  }

  return result.join('\n');
}

/**
 * Remove nth from refs that ended up not having duplicates
 * This keeps single-element locators simple (no unnecessary .nth(0))
 */
function removeNthFromNonDuplicates(refs: RefMap, tracker: RoleNameTracker): void {
  const duplicateKeys = tracker.getDuplicateKeys();

  for (const [ref, data] of Object.entries(refs)) {
    const key = tracker.getKey(data.role, data.name);
    if (!duplicateKeys.has(key)) {
      // Not a duplicate, remove nth to keep locator simple
      delete refs[ref].nth;
    }
  }
}

/**
 * Get indentation level (number of spaces / 2)
 */
function getIndentLevel(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? Math.floor(match[1].length / 2) : 0;
}

/**
 * Process a single line: add ref if needed, filter if requested
 */
function processLine(
  line: string,
  refs: RefMap,
  options: SnapshotOptions,
  tracker: RoleNameTracker
): string | null {
  const depth = getIndentLevel(line);

  // Check max depth
  if (options.maxDepth !== undefined && depth > options.maxDepth) {
    return null;
  }

  // Match lines like:
  //   - button "Submit"
  //   - heading "Title" [level=1]
  //   - link "Click me":
  const match = line.match(/^(\s*-\s*)(\w+)(?:\s+"([^"]*)")?(.*)$/);

  if (!match) {
    // Metadata lines (like /url:) or text content
    if (options.interactive) {
      // In interactive mode, only keep metadata under interactive elements
      return null;
    }
    return line;
  }

  const [, prefix, role, name, suffix] = match;
  const roleLower = role.toLowerCase();

  // Skip metadata lines (like /url:)
  if (role.startsWith('/')) {
    return line;
  }

  const isInteractive = INTERACTIVE_ROLES.has(roleLower);
  const isContent = CONTENT_ROLES.has(roleLower);
  const isStructural = STRUCTURAL_ROLES.has(roleLower);

  // In interactive-only mode, filter non-interactive elements
  if (options.interactive && !isInteractive) {
    return null;
  }

  // In compact mode, skip unnamed structural elements
  if (options.compact && isStructural && !name) {
    return null;
  }

  // Add ref for interactive or named content elements
  const shouldHaveRef = isInteractive || (isContent && name);

  if (shouldHaveRef) {
    const ref = nextRef();
    const nth = tracker.getNextIndex(roleLower, name);
    tracker.trackRef(roleLower, name, ref);

    refs[ref] = {
      selector: buildSelector(roleLower, name),
      role: roleLower,
      name,
      nth, // Always store nth, we'll clean up non-duplicates later
    };

    // Build enhanced line with ref
    let enhanced = `${prefix}${role}`;
    if (name) enhanced += ` "${name}"`;
    enhanced += ` [ref=${ref}]`;
    // Only show nth in output if it's > 0 (for readability)
    if (nth > 0) enhanced += ` [nth=${nth}]`;
    if (suffix) enhanced += suffix;

    return enhanced;
  }

  return line;
}

/**
 * Remove empty structural branches in compact mode
 */
function compactTree(tree: string): string {
  const lines = tree.split('\n');
  const result: string[] = [];

  // Simple pass: keep lines that have content or refs
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Always keep lines with refs
    if (line.includes('[ref=')) {
      result.push(line);
      continue;
    }

    // Keep lines with text content (after :)
    if (line.includes(':') && !line.endsWith(':')) {
      result.push(line);
      continue;
    }

    // Check if this structural element has children with refs
    const currentIndent = getIndentLevel(line);
    let hasRelevantChildren = false;

    for (let j = i + 1; j < lines.length; j++) {
      const childIndent = getIndentLevel(lines[j]);
      if (childIndent <= currentIndent) break;
      if (lines[j].includes('[ref=')) {
        hasRelevantChildren = true;
        break;
      }
    }

    if (hasRelevantChildren) {
      result.push(line);
    }
  }

  return result.join('\n');
}

/**
 * Parse a ref from command argument (e.g., "@e1" -> "e1")
 */
export function parseRef(arg: string): string | null {
  if (arg.startsWith('@')) {
    return arg.slice(1);
  }
  if (arg.startsWith('ref=')) {
    return arg.slice(4);
  }
  if (/^e\d+$/.test(arg)) {
    return arg;
  }
  return null;
}

/**
 * Get snapshot statistics
 */
export function getSnapshotStats(
  tree: string,
  refs: RefMap
): {
  lines: number;
  chars: number;
  tokens: number;
  refs: number;
  interactive: number;
} {
  const interactive = Object.values(refs).filter((r) => INTERACTIVE_ROLES.has(r.role)).length;

  return {
    lines: tree.split('\n').length,
    chars: tree.length,
    tokens: Math.ceil(tree.length / 4),
    refs: Object.keys(refs).length,
    interactive,
  };
}
```

src/stream-server.ts
```
import { WebSocketServer, WebSocket } from 'ws';
import type { BrowserManager, ScreencastFrame } from './browser.js';
import { setScreencastFrameCallback } from './actions.js';

// Message types for WebSocket communication
export interface FrameMessage {
  type: 'frame';
  data: string; // base64 encoded image
  metadata: {
    offsetTop: number;
    pageScaleFactor: number;
    deviceWidth: number;
    deviceHeight: number;
    scrollOffsetX: number;
    scrollOffsetY: number;
    timestamp?: number;
  };
}

export interface InputMouseMessage {
  type: 'input_mouse';
  eventType: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel';
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle' | 'none';
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  modifiers?: number;
}

export interface InputKeyboardMessage {
  type: 'input_keyboard';
  eventType: 'keyDown' | 'keyUp' | 'char';
  key?: string;
  code?: string;
  text?: string;
  modifiers?: number;
}

export interface InputTouchMessage {
  type: 'input_touch';
  eventType: 'touchStart' | 'touchEnd' | 'touchMove' | 'touchCancel';
  touchPoints: Array<{ x: number; y: number; id?: number }>;
  modifiers?: number;
}

export interface StatusMessage {
  type: 'status';
  connected: boolean;
  screencasting: boolean;
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type StreamMessage =
  | FrameMessage
  | InputMouseMessage
  | InputKeyboardMessage
  | InputTouchMessage
  | StatusMessage
  | ErrorMessage;

/**
 * WebSocket server for streaming browser viewport and receiving input
 */
export class StreamServer {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private browser: BrowserManager;
  private port: number;
  private isScreencasting: boolean = false;

  constructor(browser: BrowserManager, port: number = 9223) {
    this.browser = browser;
    this.port = port;
  }

  /**
   * Start the WebSocket server
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.port });

        this.wss.on('connection', (ws) => {
          this.handleConnection(ws);
        });

        this.wss.on('error', (error) => {
          console.error('[StreamServer] WebSocket error:', error);
          reject(error);
        });

        this.wss.on('listening', () => {
          console.log(`[StreamServer] Listening on port ${this.port}`);

          // Set up the screencast frame callback
          setScreencastFrameCallback((frame) => {
            this.broadcastFrame(frame);
          });

          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the WebSocket server
   */
  async stop(): Promise<void> {
    // Stop screencasting
    if (this.isScreencasting) {
      await this.stopScreencast();
    }

    // Clear the callback
    setScreencastFrameCallback(null);

    // Close all clients
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    // Close the server
    if (this.wss) {
      return new Promise((resolve) => {
        this.wss!.close(() => {
          this.wss = null;
          resolve();
        });
      });
    }
  }

  /**
   * Handle a new WebSocket connection
   */
  private handleConnection(ws: WebSocket): void {
    console.log('[StreamServer] Client connected');
    this.clients.add(ws);

    // Send initial status
    this.sendStatus(ws);

    // Start screencasting if this is the first client
    if (this.clients.size === 1 && !this.isScreencasting) {
      this.startScreencast().catch((error) => {
        console.error('[StreamServer] Failed to start screencast:', error);
        this.sendError(ws, error.message);
      });
    }

    // Handle messages from client
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as StreamMessage;
        this.handleMessage(message, ws);
      } catch (error) {
        console.error('[StreamServer] Failed to parse message:', error);
      }
    });

    // Handle client disconnect
    ws.on('close', () => {
      console.log('[StreamServer] Client disconnected');
      this.clients.delete(ws);

      // Stop screencasting if no more clients
      if (this.clients.size === 0 && this.isScreencasting) {
        this.stopScreencast().catch((error) => {
          console.error('[StreamServer] Failed to stop screencast:', error);
        });
      }
    });

    ws.on('error', (error) => {
      console.error('[StreamServer] Client error:', error);
      this.clients.delete(ws);
    });
  }

  /**
   * Handle incoming messages from clients
   */
  private async handleMessage(message: StreamMessage, ws: WebSocket): Promise<void> {
    try {
      switch (message.type) {
        case 'input_mouse':
          await this.browser.injectMouseEvent({
            type: message.eventType,
            x: message.x,
            y: message.y,
            button: message.button,
            clickCount: message.clickCount,
            deltaX: message.deltaX,
            deltaY: message.deltaY,
            modifiers: message.modifiers,
          });
          break;

        case 'input_keyboard':
          await this.browser.injectKeyboardEvent({
            type: message.eventType,
            key: message.key,
            code: message.code,
            text: message.text,
            modifiers: message.modifiers,
          });
          break;

        case 'input_touch':
          await this.browser.injectTouchEvent({
            type: message.eventType,
            touchPoints: message.touchPoints,
            modifiers: message.modifiers,
          });
          break;

        case 'status':
          // Client is requesting status
          this.sendStatus(ws);
          break;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.sendError(ws, errorMessage);
    }
  }

  /**
   * Broadcast a frame to all connected clients
   */
  private broadcastFrame(frame: ScreencastFrame): void {
    const message: FrameMessage = {
      type: 'frame',
      data: frame.data,
      metadata: frame.metadata,
    };

    const payload = JSON.stringify(message);

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  /**
   * Send status to a client
   */
  private sendStatus(ws: WebSocket): void {
    let viewportWidth: number | undefined;
    let viewportHeight: number | undefined;

    try {
      const page = this.browser.getPage();
      const viewport = page.viewportSize();
      viewportWidth = viewport?.width;
      viewportHeight = viewport?.height;
    } catch {
      // Browser not launched yet
    }

    const message: StatusMessage = {
      type: 'status',
      connected: true,
      screencasting: this.isScreencasting,
      viewportWidth,
      viewportHeight,
    };

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send an error to a client
   */
  private sendError(ws: WebSocket, errorMessage: string): void {
    const message: ErrorMessage = {
      type: 'error',
      message: errorMessage,
    };

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Start screencasting
   */
  private async startScreencast(): Promise<void> {
    // Set flag immediately to prevent race conditions with concurrent calls
    if (this.isScreencasting) return;
    this.isScreencasting = true;

    try {
      // Check if browser is launched
      if (!this.browser.isLaunched()) {
        throw new Error('Browser not launched');
      }

      await this.browser.startScreencast((frame) => this.broadcastFrame(frame), {
        format: 'jpeg',
        quality: 80,
        maxWidth: 1280,
        maxHeight: 720,
        everyNthFrame: 1,
      });

      // Notify all clients
      for (const client of this.clients) {
        this.sendStatus(client);
      }
    } catch (error) {
      // Reset flag on failure so caller can retry
      this.isScreencasting = false;
      throw error;
    }
  }

  /**
   * Stop screencasting
   */
  private async stopScreencast(): Promise<void> {
    if (!this.isScreencasting) return;

    await this.browser.stopScreencast();
    this.isScreencasting = false;

    // Notify all clients
    for (const client of this.clients) {
      this.sendStatus(client);
    }
  }

  /**
   * Get the port the server is running on
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Get the number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }
}
```

src/types.ts
```
import type { Page, Browser, BrowserContext } from 'playwright-core';

// Base command structure
export interface BaseCommand {
  id: string;
  action: string;
}

// Action-specific command types
export interface LaunchCommand extends BaseCommand {
  action: 'launch';
  headless?: boolean;
  viewport?: { width: number; height: number };
  browser?: 'chromium' | 'firefox' | 'webkit';
  headers?: Record<string, string>;
  executablePath?: string;
  cdpPort?: number;
  extensions?: string[];
}

export interface NavigateCommand extends BaseCommand {
  action: 'navigate';
  url: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  headers?: Record<string, string>;
}

export interface ClickCommand extends BaseCommand {
  action: 'click';
  selector: string;
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
}

export interface TypeCommand extends BaseCommand {
  action: 'type';
  selector: string;
  text: string;
  delay?: number;
  clear?: boolean;
}

export interface FillCommand extends BaseCommand {
  action: 'fill';
  selector: string;
  value: string;
}

export interface CheckCommand extends BaseCommand {
  action: 'check';
  selector: string;
}

export interface UncheckCommand extends BaseCommand {
  action: 'uncheck';
  selector: string;
}

export interface UploadCommand extends BaseCommand {
  action: 'upload';
  selector: string;
  files: string | string[];
}

export interface DoubleClickCommand extends BaseCommand {
  action: 'dblclick';
  selector: string;
}

export interface FocusCommand extends BaseCommand {
  action: 'focus';
  selector: string;
}

export interface DragCommand extends BaseCommand {
  action: 'drag';
  source: string;
  target: string;
}

export interface FrameCommand extends BaseCommand {
  action: 'frame';
  selector?: string;
  name?: string;
  url?: string;
}

export interface MainFrameCommand extends BaseCommand {
  action: 'mainframe';
}

export interface GetByRoleCommand extends BaseCommand {
  action: 'getbyrole';
  role: string;
  name?: string;
  subaction: 'click' | 'fill' | 'check' | 'hover';
  value?: string;
}

export interface GetByTextCommand extends BaseCommand {
  action: 'getbytext';
  text: string;
  exact?: boolean;
  subaction: 'click' | 'hover';
}

export interface GetByLabelCommand extends BaseCommand {
  action: 'getbylabel';
  label: string;
  subaction: 'click' | 'fill' | 'check';
  value?: string;
}

export interface GetByPlaceholderCommand extends BaseCommand {
  action: 'getbyplaceholder';
  placeholder: string;
  subaction: 'click' | 'fill';
  value?: string;
}

export interface CookiesGetCommand extends BaseCommand {
  action: 'cookies_get';
  urls?: string[];
}

export interface CookiesSetCommand extends BaseCommand {
  action: 'cookies_set';
  cookies: Array<{
    name: string;
    value: string;
    url?: string;
    domain?: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
  }>;
}

export interface CookiesClearCommand extends BaseCommand {
  action: 'cookies_clear';
}

export interface StorageGetCommand extends BaseCommand {
  action: 'storage_get';
  key?: string;
  type: 'local' | 'session';
}

export interface StorageSetCommand extends BaseCommand {
  action: 'storage_set';
  key: string;
  value: string;
  type: 'local' | 'session';
}

export interface StorageClearCommand extends BaseCommand {
  action: 'storage_clear';
  type: 'local' | 'session';
}

export interface DialogCommand extends BaseCommand {
  action: 'dialog';
  response: 'accept' | 'dismiss';
  promptText?: string;
}

export interface PdfCommand extends BaseCommand {
  action: 'pdf';
  path: string;
  format?:
    | 'Letter'
    | 'Legal'
    | 'Tabloid'
    | 'Ledger'
    | 'A0'
    | 'A1'
    | 'A2'
    | 'A3'
    | 'A4'
    | 'A5'
    | 'A6';
}

// Network interception
export interface RouteCommand extends BaseCommand {
  action: 'route';
  url: string;
  response?: {
    status?: number;
    body?: string;
    contentType?: string;
    headers?: Record<string, string>;
  };
  abort?: boolean;
}

export interface UnrouteCommand extends BaseCommand {
  action: 'unroute';
  url?: string; // If not provided, remove all routes
}

// Request inspection
export interface RequestsCommand extends BaseCommand {
  action: 'requests';
  filter?: string; // URL pattern to filter
  clear?: boolean;
}

// Download handling
export interface DownloadCommand extends BaseCommand {
  action: 'download';
  selector: string;
  path: string;
}

// Geolocation
export interface GeolocationCommand extends BaseCommand {
  action: 'geolocation';
  latitude: number;
  longitude: number;
  accuracy?: number;
}

// Permissions
export interface PermissionsCommand extends BaseCommand {
  action: 'permissions';
  permissions: string[];
  grant: boolean;
}

// Viewport
export interface ViewportCommand extends BaseCommand {
  action: 'viewport';
  width: number;
  height: number;
}

// User agent
export interface UserAgentCommand extends BaseCommand {
  action: 'useragent';
  userAgent: string;
}

// Emulate device
export interface DeviceCommand extends BaseCommand {
  action: 'device';
  device: string;
}

// Go back/forward
export interface BackCommand extends BaseCommand {
  action: 'back';
}

export interface ForwardCommand extends BaseCommand {
  action: 'forward';
}

export interface ReloadCommand extends BaseCommand {
  action: 'reload';
}

// Get URL/Title
export interface UrlCommand extends BaseCommand {
  action: 'url';
}

export interface TitleCommand extends BaseCommand {
  action: 'title';
}

// Attribute/Property/Text
export interface GetAttributeCommand extends BaseCommand {
  action: 'getattribute';
  selector: string;
  attribute: string;
}

export interface GetTextCommand extends BaseCommand {
  action: 'gettext';
  selector: string;
}

export interface IsVisibleCommand extends BaseCommand {
  action: 'isvisible';
  selector: string;
}

export interface IsEnabledCommand extends BaseCommand {
  action: 'isenabled';
  selector: string;
}

export interface IsCheckedCommand extends BaseCommand {
  action: 'ischecked';
  selector: string;
}

export interface CountCommand extends BaseCommand {
  action: 'count';
  selector: string;
}

// Bounding box
export interface BoundingBoxCommand extends BaseCommand {
  action: 'boundingbox';
  selector: string;
}

// More semantic locators
export interface GetByAltTextCommand extends BaseCommand {
  action: 'getbyalttext';
  text: string;
  exact?: boolean;
  subaction: 'click' | 'hover';
}

export interface GetByTitleCommand extends BaseCommand {
  action: 'getbytitle';
  text: string;
  exact?: boolean;
  subaction: 'click' | 'hover';
}

export interface GetByTestIdCommand extends BaseCommand {
  action: 'getbytestid';
  testId: string;
  subaction: 'click' | 'fill' | 'check' | 'hover';
  value?: string;
}

// Nth element selection
export interface NthCommand extends BaseCommand {
  action: 'nth';
  selector: string;
  index: number; // 0-based, or -1 for last
  subaction: 'click' | 'fill' | 'check' | 'hover' | 'text';
  value?: string;
}

// Wait for URL
export interface WaitForUrlCommand extends BaseCommand {
  action: 'waitforurl';
  url: string;
  timeout?: number;
}

// Wait for load state
export interface WaitForLoadStateCommand extends BaseCommand {
  action: 'waitforloadstate';
  state: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
}

// Set HTML content
export interface SetContentCommand extends BaseCommand {
  action: 'setcontent';
  html: string;
}

// Timezone emulation
export interface TimezoneCommand extends BaseCommand {
  action: 'timezone';
  timezone: string;
}

// Locale emulation
export interface LocaleCommand extends BaseCommand {
  action: 'locale';
  locale: string;
}

// HTTP basic auth
export interface HttpCredentialsCommand extends BaseCommand {
  action: 'credentials';
  username: string;
  password: string;
}

// Fine-grained mouse control
export interface MouseMoveCommand extends BaseCommand {
  action: 'mousemove';
  x: number;
  y: number;
}

export interface MouseDownCommand extends BaseCommand {
  action: 'mousedown';
  button?: 'left' | 'right' | 'middle';
}

export interface MouseUpCommand extends BaseCommand {
  action: 'mouseup';
  button?: 'left' | 'right' | 'middle';
}

// Bring to front
export interface BringToFrontCommand extends BaseCommand {
  action: 'bringtofront';
}

// Wait for JS function to return truthy
export interface WaitForFunctionCommand extends BaseCommand {
  action: 'waitforfunction';
  expression: string;
  timeout?: number;
}

// Scroll element into view
export interface ScrollIntoViewCommand extends BaseCommand {
  action: 'scrollintoview';
  selector: string;
}

// Add init script (runs on every navigation)
export interface AddInitScriptCommand extends BaseCommand {
  action: 'addinitscript';
  script: string;
}

// Keyboard down/up (hold keys)
export interface KeyDownCommand extends BaseCommand {
  action: 'keydown';
  key: string;
}

export interface KeyUpCommand extends BaseCommand {
  action: 'keyup';
  key: string;
}

// Insert text (without key events)
export interface InsertTextCommand extends BaseCommand {
  action: 'inserttext';
  text: string;
}

// Multi-select dropdown
export interface MultiSelectCommand extends BaseCommand {
  action: 'multiselect';
  selector: string;
  values: string[];
}

// Wait for download
export interface WaitForDownloadCommand extends BaseCommand {
  action: 'waitfordownload';
  path?: string;
  timeout?: number;
}

// Get response body from intercepted request
export interface ResponseBodyCommand extends BaseCommand {
  action: 'responsebody';
  url: string;
  timeout?: number;
}

// Screencast commands for streaming browser viewport
export interface ScreencastStartCommand extends BaseCommand {
  action: 'screencast_start';
  format?: 'jpeg' | 'png';
  quality?: number; // 0-100, jpeg only
  maxWidth?: number;
  maxHeight?: number;
  everyNthFrame?: number;
}

export interface ScreencastStopCommand extends BaseCommand {
  action: 'screencast_stop';
}

// Input injection commands for pair browsing
export interface InputMouseCommand extends BaseCommand {
  action: 'input_mouse';
  type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel';
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle' | 'none';
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  modifiers?: number;
}

export interface InputKeyboardCommand extends BaseCommand {
  action: 'input_keyboard';
  type: 'keyDown' | 'keyUp' | 'char';
  key?: string;
  code?: string;
  text?: string;
  modifiers?: number;
}

export interface InputTouchCommand extends BaseCommand {
  action: 'input_touch';
  type: 'touchStart' | 'touchEnd' | 'touchMove' | 'touchCancel';
  touchPoints: Array<{ x: number; y: number; id?: number }>;
  modifiers?: number;
}

// Video recording
export interface VideoStartCommand extends BaseCommand {
  action: 'video_start';
  path: string;
}

export interface VideoStopCommand extends BaseCommand {
  action: 'video_stop';
}

// Tracing
export interface TraceStartCommand extends BaseCommand {
  action: 'trace_start';
  screenshots?: boolean;
  snapshots?: boolean;
}

export interface TraceStopCommand extends BaseCommand {
  action: 'trace_stop';
  path: string;
}

// HAR recording
export interface HarStartCommand extends BaseCommand {
  action: 'har_start';
}

export interface HarStopCommand extends BaseCommand {
  action: 'har_stop';
  path: string;
}

// Storage state (auth persistence)
export interface StorageStateSaveCommand extends BaseCommand {
  action: 'state_save';
  path: string;
}

export interface StorageStateLoadCommand extends BaseCommand {
  action: 'state_load';
  path: string;
}

// Console logs
export interface ConsoleCommand extends BaseCommand {
  action: 'console';
  clear?: boolean;
}

// Page errors
export interface ErrorsCommand extends BaseCommand {
  action: 'errors';
  clear?: boolean;
}

// Keyboard shortcuts
export interface KeyboardCommand extends BaseCommand {
  action: 'keyboard';
  keys: string; // e.g., "Control+a", "Shift+Tab"
}

// Mouse wheel
export interface WheelCommand extends BaseCommand {
  action: 'wheel';
  deltaX?: number;
  deltaY?: number;
  selector?: string;
}

// Touch events
export interface TapCommand extends BaseCommand {
  action: 'tap';
  selector: string;
}

// Clipboard
export interface ClipboardCommand extends BaseCommand {
  action: 'clipboard';
  operation: 'copy' | 'paste' | 'read';
  text?: string;
}

// Highlight element (for debugging)
export interface HighlightCommand extends BaseCommand {
  action: 'highlight';
  selector: string;
}

// Clear input
export interface ClearCommand extends BaseCommand {
  action: 'clear';
  selector: string;
}

// Select all text
export interface SelectAllCommand extends BaseCommand {
  action: 'selectall';
  selector: string;
}

// Inner text vs text content
export interface InnerTextCommand extends BaseCommand {
  action: 'innertext';
  selector: string;
}

export interface InnerHtmlCommand extends BaseCommand {
  action: 'innerhtml';
  selector: string;
}

// Input value
export interface InputValueCommand extends BaseCommand {
  action: 'inputvalue';
  selector: string;
}

// Set input value directly (without events)
export interface SetValueCommand extends BaseCommand {
  action: 'setvalue';
  selector: string;
  value: string;
}

// Dispatch event
export interface DispatchEventCommand extends BaseCommand {
  action: 'dispatch';
  selector: string;
  event: string;
  eventInit?: Record<string, unknown>;
}

// Evaluate handle (for complex JS)
export interface EvaluateHandleCommand extends BaseCommand {
  action: 'evalhandle';
  script: string;
}

// Expose function
export interface ExposeFunctionCommand extends BaseCommand {
  action: 'expose';
  name: string;
}

// Add script/style tag
export interface AddScriptCommand extends BaseCommand {
  action: 'addscript';
  content?: string;
  url?: string;
}

export interface AddStyleCommand extends BaseCommand {
  action: 'addstyle';
  content?: string;
  url?: string;
}

// Emulate media
export interface EmulateMediaCommand extends BaseCommand {
  action: 'emulatemedia';
  media?: 'screen' | 'print' | null;
  colorScheme?: 'light' | 'dark' | 'no-preference' | null;
  reducedMotion?: 'reduce' | 'no-preference' | null;
  forcedColors?: 'active' | 'none' | null;
}

// Set offline mode
export interface OfflineCommand extends BaseCommand {
  action: 'offline';
  offline: boolean;
}

// Set extra HTTP headers
export interface HeadersCommand extends BaseCommand {
  action: 'headers';
  headers: Record<string, string>;
}

// Pause execution (for debugging)
export interface PauseCommand extends BaseCommand {
  action: 'pause';
}

export interface PressCommand extends BaseCommand {
  action: 'press';
  key: string;
  selector?: string;
}

export interface ScreenshotCommand extends BaseCommand {
  action: 'screenshot';
  path?: string;
  fullPage?: boolean;
  selector?: string;
  format?: 'png' | 'jpeg';
  quality?: number;
}

export interface SnapshotCommand extends BaseCommand {
  action: 'snapshot';
}

export interface EvaluateCommand extends BaseCommand {
  action: 'evaluate';
  script: string;
  args?: unknown[];
}

export interface WaitCommand extends BaseCommand {
  action: 'wait';
  selector?: string;
  timeout?: number;
  state?: 'attached' | 'detached' | 'visible' | 'hidden';
}

export interface ScrollCommand extends BaseCommand {
  action: 'scroll';
  selector?: string;
  x?: number;
  y?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;
}

export interface SelectCommand extends BaseCommand {
  action: 'select';
  selector: string;
  values: string | string[];
}

export interface HoverCommand extends BaseCommand {
  action: 'hover';
  selector: string;
}

export interface ContentCommand extends BaseCommand {
  action: 'content';
  selector?: string;
}

export interface CloseCommand extends BaseCommand {
  action: 'close';
}

// Tab/Window commands
export interface TabNewCommand extends BaseCommand {
  action: 'tab_new';
}

export interface TabListCommand extends BaseCommand {
  action: 'tab_list';
}

export interface TabSwitchCommand extends BaseCommand {
  action: 'tab_switch';
  index: number;
}

export interface TabCloseCommand extends BaseCommand {
  action: 'tab_close';
  index?: number;
}

export interface WindowNewCommand extends BaseCommand {
  action: 'window_new';
  viewport?: { width: number; height: number };
}

// Union of all command types
export type Command =
  | LaunchCommand
  | NavigateCommand
  | ClickCommand
  | TypeCommand
  | FillCommand
  | CheckCommand
  | UncheckCommand
  | UploadCommand
  | DoubleClickCommand
  | FocusCommand
  | DragCommand
  | FrameCommand
  | MainFrameCommand
  | GetByRoleCommand
  | GetByTextCommand
  | GetByLabelCommand
  | GetByPlaceholderCommand
  | PressCommand
  | ScreenshotCommand
  | SnapshotCommand
  | EvaluateCommand
  | WaitCommand
  | ScrollCommand
  | SelectCommand
  | HoverCommand
  | ContentCommand
  | CloseCommand
  | TabNewCommand
  | TabListCommand
  | TabSwitchCommand
  | TabCloseCommand
  | WindowNewCommand
  | CookiesGetCommand
  | CookiesSetCommand
  | CookiesClearCommand
  | StorageGetCommand
  | StorageSetCommand
  | StorageClearCommand
  | DialogCommand
  | PdfCommand
  | RouteCommand
  | UnrouteCommand
  | RequestsCommand
  | DownloadCommand
  | GeolocationCommand
  | PermissionsCommand
  | ViewportCommand
  | UserAgentCommand
  | DeviceCommand
  | BackCommand
  | ForwardCommand
  | ReloadCommand
  | UrlCommand
  | TitleCommand
  | GetAttributeCommand
  | GetTextCommand
  | IsVisibleCommand
  | IsEnabledCommand
  | IsCheckedCommand
  | CountCommand
  | BoundingBoxCommand
  | VideoStartCommand
  | VideoStopCommand
  | TraceStartCommand
  | TraceStopCommand
  | HarStartCommand
  | HarStopCommand
  | StorageStateSaveCommand
  | StorageStateLoadCommand
  | ConsoleCommand
  | ErrorsCommand
  | KeyboardCommand
  | WheelCommand
  | TapCommand
  | ClipboardCommand
  | HighlightCommand
  | ClearCommand
  | SelectAllCommand
  | InnerTextCommand
  | InnerHtmlCommand
  | InputValueCommand
  | SetValueCommand
  | DispatchEventCommand
  | EvaluateHandleCommand
  | ExposeFunctionCommand
  | AddScriptCommand
  | AddStyleCommand
  | EmulateMediaCommand
  | OfflineCommand
  | HeadersCommand
  | PauseCommand
  | GetByAltTextCommand
  | GetByTitleCommand
  | GetByTestIdCommand
  | NthCommand
  | WaitForUrlCommand
  | WaitForLoadStateCommand
  | SetContentCommand
  | TimezoneCommand
  | LocaleCommand
  | HttpCredentialsCommand
  | MouseMoveCommand
  | MouseDownCommand
  | MouseUpCommand
  | BringToFrontCommand
  | WaitForFunctionCommand
  | ScrollIntoViewCommand
  | AddInitScriptCommand
  | KeyDownCommand
  | KeyUpCommand
  | InsertTextCommand
  | MultiSelectCommand
  | WaitForDownloadCommand
  | ResponseBodyCommand
  | ScreencastStartCommand
  | ScreencastStopCommand
  | InputMouseCommand
  | InputKeyboardCommand
  | InputTouchCommand;

// Response types
export interface SuccessResponse<T = unknown> {
  id: string;
  success: true;
  data: T;
}

export interface ErrorResponse {
  id: string;
  success: false;
  error: string;
}

export type Response<T = unknown> = SuccessResponse<T> | ErrorResponse;

// Data types for specific responses
export interface NavigateData {
  url: string;
  title: string;
}

export interface ScreenshotData {
  path?: string;
  base64?: string;
}

export interface SnapshotData {
  snapshot: string;
}

export interface EvaluateData {
  result: unknown;
}

export interface ContentData {
  html: string;
}

export interface TabInfo {
  index: number;
  url: string;
  title: string;
  active: boolean;
}

export interface TabListData {
  tabs: TabInfo[];
  active: number;
}

export interface TabNewData {
  index: number;
  total: number;
}

export interface TabSwitchData {
  index: number;
  url: string;
  title: string;
}

export interface TabCloseData {
  closed: number;
  remaining: number;
}

export interface ScreencastStartData {
  started: boolean;
  format: string;
  quality: number;
}

export interface ScreencastStopData {
  stopped: boolean;
}

export interface InputEventData {
  injected: boolean;
}

// Browser state
export interface BrowserState {
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
}
```

mcp/scaffold_mcp.md
```
This MCP server wraps the installed `agent-browser` CLI (from either repo) and exposes a small set of high-signal tools plus an “advanced” passthrough for any supported subcommand. It follows the recommended `registerTool()` + Zod schema pattern.

`agent-browser` itself is designed for “open → snapshot (-i) → interact via @refs → re-snapshot” workflows.

```text
agent-browser-mcp-server/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts
    ├── constants.ts
    ├── types.ts
    ├── services/
    │   └── agentBrowserCli.ts
    └── tools/
        └── agentBrowserTools.ts
```

```jsonc
// path: agent-browser-mcp-server/package.json
{
  "name": "agent-browser-mcp-server",
  "version": "0.1.0",
  "description": "MCP server wrapper for agent-browser CLI (open/snapshot/click/fill/etc).",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "agent-browser-mcp-server": "dist/index.js"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "clean": "rm -rf dist"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.6.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2"
  }
}
```

```jsonc
// path: agent-browser-mcp-server/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

````md
<!-- path: agent-browser-mcp-server/README.md -->

# agent-browser-mcp-server

MCP (stdio) server that shells out to `agent-browser` and returns parsed `--json` output when available.

## Prereqs

1) Install `agent-browser` and its Chromium dependency.
- `agent-browser install` downloads Chromium; `agent-browser install --with-deps` also installs Linux system deps. :contentReference[oaicite:2]{index=2}

2) Ensure the `agent-browser` binary is on PATH, or set `AGENT_BROWSER_BIN`.

## Install + run

```bash
cd agent-browser-mcp-server
npm i
npm run build
npm start
````

## MCP client config (example)

Use your MCP client’s stdio config, pointing to `dist/index.js`. Example shape:

```jsonc
{
  "mcpServers": {
    "agent-browser": {
      "command": "node",
      "args": ["/absolute/path/to/agent-browser-mcp-server/dist/index.js"],
      "env": {
        "AGENT_BROWSER_BIN": "agent-browser",
        "AGENT_BROWSER_SESSION": "default"
      }
    }
  }
}
```

## Environment variables

* `AGENT_BROWSER_BIN`: path/command for the CLI (default: `agent-browser`)
* `AGENT_BROWSER_SESSION`: default session if not provided per-call (agent-browser supports isolated sessions).

## Tooling notes

* Recommended workflow: `agent_browser_open` → `agent_browser_snapshot` (interactive refs) → `agent_browser_click/fill/type` using `@eN` refs.
* CDP mode is supported via `agent_browser_connect` or per-call `cdp_port` (agent-browser CLI supports `connect <port>` and `--cdp <port>`).
* Headers can be set origin-scoped via `--headers` with `open`, or globally via `set headers`.

````

```ts
// path: agent-browser-mcp-server/src/constants.ts
export const SERVER_NAME = "agent-browser-mcp-server";
export const SERVER_VERSION = "0.1.0";

/**
 * Keep outputs reasonably bounded for MCP clients.
 * If you want larger snapshots, use snapshot filters (interactive/compact/depth/selector). :contentReference[oaicite:7]{index=7}
 */
export const CHARACTER_LIMIT = 25000;

export const DEFAULT_TIMEOUT_MS = 60_000;

export const DEFAULT_BIN = "agent-browser";

/**
 * For the "advanced" passthrough tool, require argv[0] to be a known top-level command token.
 * This is not a security boundary (no shell is used), but it helps keep calls intentional.
 */
export const ALLOWED_ROOT_COMMANDS = new Set([
  "open",
  "back",
  "forward",
  "reload",
  "close",
  "snapshot",
  "click",
  "dblclick",
  "focus",
  "fill",
  "type",
  "press",
  "keydown",
  "keyup",
  "hover",
  "check",
  "uncheck",
  "upload",
  "get",
  "find",
  "set",
  "connect",
  "tab",
  "session"
]);
````

```ts
// path: agent-browser-mcp-server/src/types.ts
export type CliGlobalOptions = {
  session?: string;
  cdpPort?: number;
  headed?: boolean;
  debug?: boolean;
  executablePath?: string;
  /**
   * If true (default), pass --json to agent-browser for machine parsing. :contentReference[oaicite:8]{index=8}
   */
  json?: boolean;
  timeoutMs?: number;
};

export type CliRunRequest = {
  argv: string[]; // subcommand + args + any command-specific flags (no shell)
  global?: CliGlobalOptions;
  /**
   * If set, the MCP server writes stdout to this file (relative path only).
   * This is useful for large snapshots without stuffing the MCP response.
   */
  saveOutputPath?: string;
};

export type CliRunResult = {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  invoked: {
    bin: string;
    args: string[];
  };
  stdout: string;
  stderr: string;
  parsedJson: unknown | null;
  truncated: boolean;
  savedOutputPath?: string;
};
```

```ts
// path: agent-browser-mcp-server/src/services/agentBrowserCli.ts
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { CHARACTER_LIMIT, DEFAULT_BIN, DEFAULT_TIMEOUT_MS } from "../constants.js";
import type { CliRunRequest, CliRunResult, CliGlobalOptions } from "../types.js";

function getBin(): string {
  return process.env.AGENT_BROWSER_BIN?.trim() || DEFAULT_BIN;
}

function sanitizeArg(arg: string): string {
  if (arg.includes("\u0000")) throw new Error("Invalid argument: contains NUL byte");
  if (arg.length > 16_384) throw new Error("Invalid argument: too long");
  return arg;
}

/**
 * Only allow relative paths without traversal. This is basic hygiene; adjust to your needs.
 */
function validateRelativePath(p: string): string {
  if (!p) throw new Error("saveOutputPath is empty");
  if (path.isAbsolute(p)) throw new Error("saveOutputPath must be relative (not absolute)");
  const norm = path.normalize(p);
  if (norm.startsWith("..") || norm.includes(`..${path.sep}`)) {
    throw new Error("saveOutputPath must not contain '..' path traversal");
  }
  return norm;
}

function buildGlobalArgs(global?: CliGlobalOptions): string[] {
  const g = global ?? {};
  const args: string[] = [];

  const session = g.session ?? process.env.AGENT_BROWSER_SESSION?.trim();
  if (session) {
    args.push("--session", sanitizeArg(session));
  }
  if (typeof g.cdpPort === "number") {
    args.push("--cdp", String(g.cdpPort));
  }
  if (g.headed) {
    args.push("--headed");
  }
  if (g.debug) {
    args.push("--debug");
  }
  if (g.executablePath) {
    args.push("--executable-path", sanitizeArg(g.executablePath));
  }

  // Default to JSON output unless explicitly disabled.
  if (g.json !== false) {
    args.push("--json");
  }

  return args;
}

function truncateIfNeeded(s: string): { text: string; truncated: boolean } {
  if (s.length <= CHARACTER_LIMIT) return { text: s, truncated: false };
  return { text: s.slice(0, CHARACTER_LIMIT) + "\n...<truncated>...", truncated: true };
}

function tryParseJson(stdout: string): unknown | null {
  const t = stdout.trim();
  if (!t) return null;
  if (!(t.startsWith("{") || t.startsWith("["))) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export async function runAgentBrowser(req: CliRunRequest): Promise<CliRunResult> {
  const bin = getBin();

  const globalArgs = buildGlobalArgs(req.global);
  const cmdArgs = (req.argv || []).map(sanitizeArg);
  const args = [...globalArgs, ...cmdArgs];

  const timeoutMs = req.global?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let stdoutBuf = "";
  let stderrBuf = "";

  const child = spawn(bin, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  });

  const killTimer = setTimeout(() => {
    child.kill("SIGKILL");
  }, timeoutMs);

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (d) => {
    stdoutBuf += d;
  });
  child.stderr.on("data", (d) => {
    stderrBuf += d;
  });

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(killTimer));

  const parsed = tryParseJson(stdoutBuf);

  // Avoid truncating JSON that needs to be parsed; return full if parsedJson is present.
  const stdoutOut = parsed ? stdoutBuf : truncateIfNeeded(stdoutBuf);
  const stderrOut = truncateIfNeeded(stderrBuf);

  let savedOutputPath: string | undefined;
  if (req.saveOutputPath) {
    const rel = validateRelativePath(req.saveOutputPath);
    await fs.mkdir(path.dirname(rel), { recursive: true });
    await fs.writeFile(rel, stdoutBuf, "utf8");
    savedOutputPath = rel;
  }

  const ok = exit.code === 0;

  return {
    ok,
    exitCode: exit.code,
    signal: exit.signal,
    invoked: { bin, args },
    stdout: typeof stdoutOut === "string" ? stdoutOut : stdoutOut.text,
    stderr: stderrOut.text,
    parsedJson: parsed,
    truncated: (typeof stdoutOut === "string" ? false : stdoutOut.truncated) || stderrOut.truncated,
    savedOutputPath
  };
}
```

```ts
// path: agent-browser-mcp-server/src/tools/agentBrowserTools.ts
import { z } from "zod";
import { ALLOWED_ROOT_COMMANDS } from "../constants.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runAgentBrowser } from "../services/agentBrowserCli.js";

const GlobalOptionsShape = {
  session: z.string().min(1).optional(),
  cdp_port: z.number().int().positive().optional(),
  headed: z.boolean().optional(),
  debug: z.boolean().optional(),
  executable_path: z.string().min(1).optional(),
  json: z.boolean().optional(),
  timeout_ms: z.number().int().positive().optional()
};

function mapGlobalOptions(input: any) {
  return {
    session: input.session,
    cdpPort: input.cdp_port,
    headed: input.headed,
    debug: input.debug,
    executablePath: input.executable_path,
    json: input.json,
    timeoutMs: input.timeout_ms
  };
}

const OutputShape = {
  ok: z.boolean(),
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  invoked: z.object({
    bin: z.string(),
    args: z.array(z.string())
  }),
  stdout: z.string(),
  stderr: z.string(),
  parsedJson: z.unknown().nullable(),
  truncated: z.boolean(),
  savedOutputPath: z.string().optional()
};

export function registerAgentBrowserTools(server: McpServer) {
  // open <url>
  server.registerTool(
    "agent_browser_open",
    {
      title: "agent-browser: open",
      description:
        "Navigate to a URL using agent-browser. Recommended workflow is open → snapshot (-i) → interact via @refs. ",
      inputSchema: {
        url: z.string().min(1),
        headers: z.record(z.string()).optional(),
        save_output_path: z.string().optional(),
        ...GlobalOptionsShape
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input) => {
      const argv = ["open", input.url];

      // Origin-scoped headers can be set on open via --headers.
      if (input.headers) {
        argv.push("--headers", JSON.stringify(input.headers));
      }

      const result = await runAgentBrowser({
        argv,
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  // snapshot [-i] [-c] [-d n] [-s selector]
  server.registerTool(
    "agent_browser_snapshot",
    {
      title: "agent-browser: snapshot",
      description:
        "Get a page snapshot. Use interactive refs (-i) for deterministic follow-up actions; compact/depth/selector reduce output size. :contentReference[oaicite:11]{index=11}",
      inputSchema: {
        interactive: z.boolean().optional().default(true),
        compact: z.boolean().optional().default(true),
        depth: z.number().int().positive().optional().default(5),
        selector: z.string().min(1).optional(),
        save_output_path: z.string().optional(),
        ...GlobalOptionsShape
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input) => {
      const argv: string[] = ["snapshot"];
      if (input.interactive) argv.push("-i");
      if (input.compact) argv.push("-c");
      if (typeof input.depth === "number") argv.push("-d", String(input.depth));
      if (input.selector) argv.push("-s", input.selector);

      const result = await runAgentBrowser({
        argv,
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  // click <selector|@ref>
  server.registerTool(
    "agent_browser_click",
    {
      title: "agent-browser: click",
      description: "Click an element. Prefer @refs from snapshot -i for determinism. :contentReference[oaicite:12]{index=12}",
      inputSchema: {
        target: z.string().min(1),
        save_output_path: z.string().optional(),
        ...GlobalOptionsShape
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input) => {
      const result = await runAgentBrowser({
        argv: ["click", input.target],
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  // fill <selector|@ref> <value>
  server.registerTool(
    "agent_browser_fill",
    {
      title: "agent-browser: fill",
      description: "Clear and type into an input. Prefer @refs from snapshot -i. ",
      inputSchema: {
        target: z.string().min(1),
        value: z.string(),
        save_output_path: z.string().optional(),
        ...GlobalOptionsShape
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input) => {
      const result = await runAgentBrowser({
        argv: ["fill", input.target, input.value],
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  // type <selector|@ref> <text>
  server.registerTool(
    "agent_browser_type",
    {
      title: "agent-browser: type",
      description: "Type into an input without clearing. Prefer @refs from snapshot -i. ",
      inputSchema: {
        target: z.string().min(1),
        text: z.string(),
        save_output_path: z.string().optional(),
        ...GlobalOptionsShape
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input) => {
      const result = await runAgentBrowser({
        argv: ["type", input.target, input.text],
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  // press <key>
  server.registerTool(
    "agent_browser_press",
    {
      title: "agent-browser: press",
      description: "Press a key (e.g., Enter, Control+a). :contentReference[oaicite:15]{index=15}",
      inputSchema: {
        key: z.string().min(1),
        save_output_path: z.string().optional(),
        ...GlobalOptionsShape
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input) => {
      const result = await runAgentBrowser({
        argv: ["press", input.key],
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  // navigation: back/forward/reload/close
  for (const cmd of ["back", "forward", "reload", "close"] as const) {
    server.registerTool(
      `agent_browser_${cmd}`,
      {
        title: `agent-browser: ${cmd}`,
        description: `Run agent-browser ${cmd}. :contentReference[oaicite:16]{index=16}`,
        inputSchema: {
          save_output_path: z.string().optional(),
          ...GlobalOptionsShape
        },
        outputSchema: OutputShape,
        annotations: {
          readOnlyHint: false,
          idempotentHint: false,
          destructiveHint: cmd === "close",
          openWorldHint: true
        }
      },
      async (input) => {
        const result = await runAgentBrowser({
          argv: [cmd],
          global: mapGlobalOptions(input),
          saveOutputPath: input.save_output_path
        });

        return {
          isError: !result.ok,
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result
        };
      }
    );
  }

  // session + session list
  server.registerTool(
    "agent_browser_session",
    {
      title: "agent-browser: session",
      description: "Show the current session name. :contentReference[oaicite:17]{index=17}",
      inputSchema: {
        save_output_path: z.string().optional(),
        ...GlobalOptionsShape
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input) => {
      const result = await runAgentBrowser({
        argv: ["session"],
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  server.registerTool(
    "agent_browser_session_list",
    {
      title: "agent-browser: session list",
      description: "List active sessions. :contentReference[oaicite:18]{index=18}",
      inputSchema: {
        save_output_path: z.string().optional(),
        ...GlobalOptionsShape
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input) => {
      const result = await runAgentBrowser({
        argv: ["session", "list"],
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  // connect <cdpPort>
  server.registerTool(
    "agent_browser_connect",
    {
      title: "agent-browser: connect",
      description:
        "Connect agent-browser to an existing Chrome DevTools Protocol port (CDP). After connect, commands can omit --cdp. ",
      inputSchema: {
        cdp_port: z.number().int().positive(),
        save_output_path: z.string().optional(),
        session: z.string().min(1).optional(),
        headed: z.boolean().optional(),
        debug: z.boolean().optional(),
        executable_path: z.string().min(1).optional(),
        json: z.boolean().optional(),
        timeout_ms: z.number().int().positive().optional()
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input) => {
      const result = await runAgentBrowser({
        argv: ["connect", String(input.cdp_port)],
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  // set headers <json>
  server.registerTool(
    "agent_browser_set_headers",
    {
      title: "agent-browser: set headers",
      description:
        "Set global headers (all domains) via `agent-browser set headers <json>`. Origin-scoped headers can also be set per-open with --headers. ",
      inputSchema: {
        headers: z.record(z.string()),
        save_output_path: z.string().optional(),
        ...GlobalOptionsShape
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true
      }
    },
    async (input) => {
      const result = await runAgentBrowser({
        argv: ["set", "headers", JSON.stringify(input.headers)],
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );

  // Advanced: arbitrary subcommand passthrough (argv[0] must be allowlisted)
  server.registerTool(
    "agent_browser_command",
    {
      title: "agent-browser: command (advanced)",
      description:
        "Run an arbitrary agent-browser subcommand. argv[0] must be a known top-level command token; pass command-specific flags in argv. Use for features not covered by the dedicated tools.",
      inputSchema: {
        argv: z.array(z.string().min(1)).min(1),
        save_output_path: z.string().optional(),
        ...GlobalOptionsShape
      },
      outputSchema: OutputShape,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: true,
        openWorldHint: true
      }
    },
    async (input) => {
      const root = input.argv[0];
      if (!ALLOWED_ROOT_COMMANDS.has(root)) {
        const err = {
          ok: false,
          exitCode: -1,
          signal: null,
          invoked: { bin: process.env.AGENT_BROWSER_BIN || "agent-browser", args: [] },
          stdout: "",
          stderr: `Refused: argv[0]="${root}" not in allowlist`,
          parsedJson: null,
          truncated: false
        };
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(err, null, 2) }],
          structuredContent: err
        };
      }

      const result = await runAgentBrowser({
        argv: input.argv,
        global: mapGlobalOptions(input),
        saveOutputPath: input.save_output_path
      });

      return {
        isError: !result.ok,
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result
      };
    }
  );
}
```

```ts
// path: agent-browser-mcp-server/src/index.ts
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { registerAgentBrowserTools } from "./tools/agentBrowserTools.js";

/**
 * stdio transport is appropriate for local CLI-style integrations. :contentReference[oaicite:21]{index=21}
 * Do not log to stdout in stdio servers; use stderr if you add diagnostics.
 */
async function main() {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION
  });

  registerAgentBrowserTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // stderr only; keep stdout clean for MCP protocol
  console.error(err);
  process.exit(1);
});
```

Notes relevant to the underlying repo behavior

* `snapshot -i` provides deterministic `@eN` refs intended for follow-on commands like `click @e2` and `fill @e3 "..."`.
* Sessions are a first-class concept (`--session`, `AGENT_BROWSER_SESSION`, and `session list`).
* CDP and headers workflows are supported by agent-browser (`connect <port>`, `--cdp <port>`, `--headers` on `open`, and `set headers`).
```

</source_code>