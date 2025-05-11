import * as Constant from '../const/constants';
import * as vscode from 'vscode';
import { logger } from '../logger/logger';
import { runCommand } from './command-utils';
import { Packages, ProgramLanguage, FrameworkTestCsharpSchema } from '../config/lang-config';
import { SettingsSchema } from './setting-utils';
import path from 'path';
import * as fs from 'fs';
import { parseStringPromise, Builder } from 'xml2js';
import { writeFile } from './file-folder-utils';
import { CLICommand } from '../config/cli-config';
import * as langConfig from '../config/lang-config';

/**
 * Tìm kiếm package trong nội dung file Gradle dựa trên biểu thức chính quy.
 * @param {string} contentGradle - Nội dung file build.gradle.
 * @param {RegExp} pakageRegex - Biểu thức chính quy để tìm kiếm package.
 * Ví dụ: plugins => /^\s*plugins\s*\{\s*([\s\S]*?)\s*\}\s*$/ms
 * @returns {{ packageJava: string; isExists: boolean }} -
 *    - `packageJava`: Nội dung package được tìm thấy (nếu có).
 *    - `isExists`: `true` nếu package tồn tại, ngược lại là `false`.
 * @remarks
 *    - Hàm sử dụng `match` để tìm kiếm package trong nội dung file Gradle.
 *    - Nếu tìm thấy, trả về tên package và trạng thái tồn tại.
 *    - Nếu không tìm thấy, trả về chuỗi rỗng và trạng thái không tồn tại.
 */
function findPackage(contentGradle: string, pakageRegex: any): { packageJava: string; isExists: boolean } {
  const match = contentGradle.match(pakageRegex);
  return { packageJava: match ? match[1] || '' : '', isExists: !!match };
}

/**
 * Thêm các item mới vào nội dung package nếu chúng chưa tồn tại.
 * @param {string} packageJava - Nội dung package hiện tại.
 * @param {string[]} items - Mảng các item cần thêm vào package.
 * @returns {{ adjustPackage: string; isChanged: boolean }} -
 *    - `adjustPackage`: Nội dung package sau khi đã thêm các item mới.
 *    - `isChanged`: `true` nếu nội dung package đã thay đổi, ngược lại là `false`.
 * @remarks
 *    - Hàm duyệt qua danh sách `items` và kiểm tra xem mỗi item đã tồn tại trong `packageJava` chưa.
 *    - Nếu một item chưa tồn tại, nó sẽ được thêm vào `packageJava`.
 *    - Các item được thêm vào sẽ được định dạng với ký tự ngắt dòng và tab từ `Constant.Common`.
 * @example
 * const packageJava = ["id 'java'"];
 * const items = ["id 'jacoco'", "id 'groovy'"];
 * await addItemsToPackage(packageJava, items);
 * => packageJava = ["id 'java'", "id 'jacoco'", "id 'groovy'"]
 */
function addItemsToPackage(packageJava: string, items: string[]): { adjustPackage: string; isChanged: boolean } {
  let adjustPackage = packageJava;
  const adjustItems = items.map((str) => str.trim());
  for (const item of adjustItems) {
    if (!adjustPackage.includes(item)) {
      adjustPackage += `${Constant.Symbol.BREAK_LINE}${Constant.Symbol.SPACE}${item}`;
    }
  }

  return { adjustPackage, isChanged: adjustPackage !== packageJava };
}

/**
 * Cập nhật nội dung của một package trong file Gradle.
 * @param {string} contentGradle - Nội dung hiện tại của file build.gradle.
 * @param {string} adjustPackage - Nội dung package đã được điều chỉnh (sau khi thêm các item mới).
 * @param {string} packageName - Tên của package cần cập nhật (ví dụ: plugins, dependencies).
 * @param {boolean} isExists - Trạng thái tồn tại của package trong file Gradle (`true` nếu package đã tồn tại, ngược lại là `false`).
 * @param {RegExp} pakageRegex - Biểu thức chính quy để tìm kiếm package trong nội dung file Gradle.
 * Ví dụ: plugins => /^\s*plugins\s*\{\s*([\s\S]*?)\s*\}\s*$/ms
 * @returns {string} - Nội dung file Gradle sau khi đã cập nhật package.
 * @remarks
 *    - Hàm tạo nội dung package mới từ `adjustPackage` và định dạng các dòng với ký tự tab.
 *    - Nếu package đã tồn tại (`isExists` là `true`), thay thế nội dung package cũ bằng package mới.
 *    - Nếu package chưa tồn tại (`isExists` là `false`), thêm package mới vào cuối file Gradle.
 */
function updateContentInPackage(
  contentGradle: string,
  adjustPackage: string,
  packageName: string,
  isExists: boolean,
  pakageRegex: any
): string {
  const updatedPackageContent = adjustPackage
    .trim()
    .split(Constant.Symbol.BREAK_LINE)
    .map((line) => `${Constant.Symbol.SPACE}${line.trim()}`)
    .filter((line) => line !== Constant.Common.BLANK)
    .join(Constant.Symbol.BREAK_LINE);
  const newPackage = `${packageName} {${Constant.Symbol.BREAK_LINE}${updatedPackageContent.trim()}${Constant.Symbol.BREAK_LINE}}`;

  if (isExists) {
    return contentGradle.replace(pakageRegex, newPackage).trim();
  }
  return `${contentGradle.trim()}${Constant.Symbol.BREAK_LINE}${Constant.Symbol.BREAK_LINE}${newPackage.trim()}`.trim();
}

/**
 * Cập nhật file build.gradle bằng cách thêm hoặc thay thế các cấu hình (plugins, dependencies, test, jacocoTestReport).
 * @param {string} buildGradlePath - Đường dẫn đến file build.gradle cần cập nhật.
 * @param {string} contentGradle - Nội dung hiện tại của file build.gradle.
 * @param {string[]} items - Mảng các item cần thêm vào package.
 * @param {string} packageName - Tên của package cần cập nhật (ví dụ: plugins, dependencies).
 * @returns {Promise<void>} - Promise không trả về giá trị khi hoàn thành.
 * @remarks
 *    - Hàm đọc nội dung file build.gradle, sau đó thực hiện các thay đổi:
 *        + Bổ sung các items trong pakage `plugins` nếu còn thiếu.
 *        + Bổ sung các items trong pakage `dependencies` nếu còn thiếu.
 *        + Bổ sung các items trong pakage `test` nếu còn thiếu.
 *        + Nếu package `jacocoTestReport` đã tồn tại thì bỏ qua còn không thực hiện thêm mới(cải tiến sau này).
 *    - Nếu nội dung file build.gradle thay đổi, hàm sẽ ghi lại nội dung mới vào file.
 *    - Nếu không có thay đổi nào, file sẽ không bị ghi đè.
 * @example
 * // Ví dụ: Cập nhật file build.gradle để thêm các cấu hình sau:
 * // - plugins { id 'java', id 'jacoco' }
 * // - dependencies { testImplementation 'junit:junit:4.13.2', testImplementation 'org.junit.platform:junit-platform-launcher' }
 * // - test { useJUnitPlatform() }
 * // - jacocoTestReport { ... }
 * await updateGradleBuildFile(buildGradlePath);
 *
 * // Nội dung trước khi cập nhật:
 * plugins {
 *   id 'groovy'
 * }
 * dependencies {
 *   implementation 'org.apache.commons:commons-lang3:3.12.0'
 * }
 *
 * // Nội dung sau khi cập nhật:
 * plugins {
 *   id 'groovy'
 *   id 'java'
 *   id 'jacoco'
 * }
 * dependencies {
 *   implementation 'org.apache.commons:commons-lang3:3.12.0'
 *   testImplementation 'junit:junit:4.13.2'
 *   testImplementation 'org.junit.platform:junit-platform-launcher'
 * }
 * test {
 *   useJUnitPlatform()
 * }
 * jacocoTestReport {
 *   dependsOn test
 *   reports {
 *     csv.required = true
 *     csv.destination file("${project.rootDir}/target/site/jacoco/jacoco.csv")
 *   }
 * }
 */
async function updateGradleBuildFile(buildGradlePath: string, contentGradle: string, items: string[], packageName: string): Promise<void> {
  const packageRegex = new RegExp(
    Packages.java.gradle.regexConfig.template.replace(Packages.java.gradle.keyReplace, packageName),
    Packages.java.gradle.regexConfig.flag
  );
  const { packageJava, isExists } = findPackage(contentGradle, packageRegex);
  const { adjustPackage, isChanged } = addItemsToPackage(packageJava, items);

  if (isExists && packageName === Packages.java.gradle.packageInfo.jacocoTestReport) {
    return;
  }
  isChanged && (contentGradle = updateContentInPackage(contentGradle, adjustPackage, packageName, isExists, packageRegex));

  await writeFile(buildGradlePath, contentGradle);
}

/**
 * Thêm các package cần thiết cho dự án test dựa trên ngôn ngữ lập trình và cấu hình.
 * @param {Object} params - Các tham số đầu vào.
 * @param {ProgramLanguage} params.programLanguage - Ngôn ngữ lập trình của dự án (ví dụ: CSHARP, JAVA).
 * @param {string} params.rootProjectPath - Đường dẫn gốc của dự án.
 * @param {string} params.sourcePath - Đường dẫn đến thư mục chứa mã nguồn.
 * @param {string} params.testFolderPath - Đường dẫn đến thư mục chứa mã test.
 * @param {SettingsSchema} params.settings - Cấu hình của dự án (bao gồm thông tin framework, thư mục test, v.v.).
 * @param {vscode.OutputChannel} params.outputChannel - Kênh đầu ra của VS Code để hiển thị thông tin.
 * @returns {Promise<void>} - Không trả về giá trị.
 * @throws {Error} - Nếu ngôn ngữ không được hỗ trợ hoặc xảy ra lỗi trong quá trình xử lý.
 * @remarks
 *    - Đối với C#:
 *        + Thêm các package NuGet cần thiết dựa trên framework test (xUnit, NUnit, MSTest).
 *        + Thực hiện lệnh `dotnet add package` để thêm package vào dự án.
 *        + Thêm tham chiếu giữa thư mục mã nguồn và thư mục test.
 *    - Đối với Java:
 *        + Maven: Thêm các dependency vào tệp 'pom.xml` xem tại (lang-config.ts)
 *            + Bao gồm:
 *              1. testSourceDirectory: đường dẫn chứa folder test.
 *              2. jacoco: công cụ tính đo coverage.
 *              3. package cho framework test.
 *                  TODO:
 *                    Hiện tại chỉ hỗ trợ add package cho junit4/ junit5
 *                  (* Phát triển sau đối với các framework test: testng, spock)
 *
 *         + Gradle:
 *              có 4 package : plugins, dependencies, test, jacocoTestReport
 *                - plugins, dependencies, test các item chưa có thì bổ sung thêm
 *                - jacocoTestReport:
 *                      Nếu package name jacocoTestReport có rồi thì bỏ qua (không chỉnh sửa)
 *                        TODO: chỉnh sửa giá trị mới khi jacocoTestReport đã có sẽ phát triển trong tương lai
 *                      Ngược lại: thêm mới jacocoTestReport các giá trị item trong cấu hình Packages.java.gradle trong lang-config.ts
 */
export const addPackageForTestProject = async ({
  programLanguage,
  rootProjectPath,
  sourcePath,
  testFolderPath,
  settings,
  outputChannel,
}: {
  programLanguage: ProgramLanguage;
  rootProjectPath: string;
  sourcePath: string;
  testFolderPath: string;
  settings: SettingsSchema;
  outputChannel: vscode.OutputChannel;
}) => {
  logger.output(Constant.Messages.MSG_OUT_PROCESSING_ADD_PACKAGE_START, outputChannel);
  if (programLanguage === ProgramLanguage.CSHARP) {
    const frameworkTest = settings.csharpConfig[Constant.Common.FRAMEWORK_TEST] as FrameworkTestCsharpSchema;
    const packagesToAdd: string[] = [...Object.values(Packages.csharp.test), ...Object.values(Packages.csharp[frameworkTest])];

    logger.output(Constant.Messages.MSG_OUT_PROCEED_TO_LOAD_LIBRARIES, outputChannel);

    for (const packageName of packagesToAdd) {
      await runCommand(testFolderPath, CLICommand.csharp.DOTNET_ADD_PACKAGE, [packageName], outputChannel);
      logger.output(`${Constant.Messages.MSG_OUT_ADDED_NUGET_PACKAGE} ${packageName}`, outputChannel);
    }

    const relativeSourceFolderPath = path.relative(rootProjectPath, sourcePath);
    const relativeTestFolderPath = path.relative(rootProjectPath, testFolderPath);

    await runCommand(
      rootProjectPath,
      CLICommand.csharp.DOTNET_ADD,
      [relativeTestFolderPath, CLICommand.csharp.REFERENCE, relativeSourceFolderPath],
      outputChannel
    );

    logger.output(Constant.Messages.MSG_OUT_PROCESSING_ADD_PACKAGE_END, outputChannel);

    return;
  }

  if (programLanguage === ProgramLanguage.JAVA) {
    const pomFile = path.join(rootProjectPath, Constant.Common.POM_FILE);
    const buildGradleFile = path.join(rootProjectPath, Constant.Common.GRADLE_FILE);
    const frameworkTest = settings.javaConfig[Constant.Common.FRAMEWORK_TEST];
    const testSourceDirectory =
      settings.generalConfig[Constant.Common.TEST_FOLDER_PATH]?.trim() ||
      langConfig.TestFile.java.folderTest[frameworkTest as keyof typeof langConfig.frameworkTest.java];

    if (!fs.existsSync(pomFile) && !fs.existsSync(buildGradleFile)) {
      throw new Error(Constant.Messages.MSG_ERR_JAVA_PROJECT_WITHOUT_BUILD_TOOLS);
    }
    if (fs.existsSync(pomFile)) {
      const dependencies = [
        {
          path: Packages.java.maven.testSourceDirectory.path,
          value: testSourceDirectory,
        },
        {
          path: Packages.java.maven.jacoco.path,
          value: Packages.java.maven.jacoco.value,
        },
        {
          path: Packages.java.maven.test[frameworkTest as keyof typeof Packages.java.maven.test].path,
          value: Packages.java.maven.test[frameworkTest as keyof typeof Packages.java.maven.test].value,
        },
      ];

      for (const dependency of dependencies) {
        await addPackageToPOM(
          pomFile,
          dependency.path,
          [Packages.java.maven.key.ARTIFACTID, Packages.java.maven.key.GROUPID],
          dependency.value,
          dependency.path === Packages.java.maven.jacoco.path
        );
      }

      return;
    }
    if (fs.existsSync(buildGradleFile)) {
      let gradleConfigs: any[] = [];
      Object.entries(Packages.java.gradle.package).forEach(([key, value]) => {
        gradleConfigs.push({
          items:
            key === Packages.java.gradle.packageInfo.dependencies
              ? Packages.java.gradle.package.dependencies[frameworkTest as keyof typeof Packages.java.gradle.package.dependencies] || value
              : value,
          packageName: key,
        });
      });

      for (const config of gradleConfigs) {
        let contentGradle = await fs.promises.readFile(buildGradleFile, Constant.Common.UTF8);
        await updateGradleBuildFile(buildGradleFile, contentGradle, config.items, config.packageName);
      }
      return;
    }

    logger.output(Constant.Messages.MSG_OUT_PROCESSING_ADD_PACKAGE_END, outputChannel);
  }

  throw new Error(Constant.Messages.MSG_ERR_LANGUAGE_NOT_SUPPORTED);
};

/**
 * Thêm một dependency vào tệp POM (pom.xml) của dự án Maven.
 * @param {string} filePath - Đường dẫn đến tệp POM (pom.xml).
 * @param {string[]} path - Đường dẫn đến vị trí cần thêm dependency trong cấu trúc XML.
 * @param {string[]} keyList - Danh sách các khóa để xác định dependency (ví dụ: groupId, artifactId).
 * @param {any} value - Giá trị của dependency cần thêm (ví dụ: groupId, artifactId, version).
 * @param {boolean} [isReplaceMatch=false] - Nếu `true`, thay thế giá trị của dependency đã tồn tại bằng giá trị mới.
 * @returns {Promise<void>} - Không trả về giá trị.
 * @remarks
 *    - Hàm kiểm tra xem dependency đã tồn tại chưa.
 *        + Nếu chưa, nó sẽ thêm dependency vào tệp POM.
 *        + Nếu đã tồn tại và `isReplaceMatch` là `true`, thay thế giá trị của dependency hiện tại bằng giá trị mới.
 *    - Sau khi thêm, tệp POM sẽ được ghi lại với nội dung đã cập nhật.
 */
export const addPackageToPOM = async (filePath: string, path: string[], keyList: string[], value: any, isReplaceMatch: boolean = false) => {
  const xmlObject = await convertXMLFiletoObject(filePath);
  const nodeList = getOrCreateNodeListByPath(xmlObject, path);
  let matchNode = findNodeByKeyAndValue(nodeList, keyList, value);

  if (!matchNode) {
    addNode(nodeList, value);
  } else if (isReplaceMatch) {
    Object.assign(matchNode, value);
  }

  await writeXMLFile(filePath, xmlObject);
};

/**
 * Chuyển đổi nội dung của tệp XML thành một đối tượng JavaScript.
 * @param {string} filePath - Đường dẫn đến tệp XML cần chuyển đổi.
 * @returns {Promise<any>} - Đối tượng JavaScript được chuyển đổi từ nội dung XML.
 * @throws {Error} - Nếu tệp không tồn tại hoặc xảy ra lỗi trong quá trình chuyển đổi.
 * @remarks
 *    - Hàm sử dụng `fs` để đọc nội dung tệp và `xml2js` để phân tích cú pháp XML.
 *    - Nếu tệp không tồn tại, ném lỗi với thông báo chi tiết.
 */
export const convertXMLFiletoObject = async (filePath: string) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${Constant.Messages.MSG_OUT_NOT_FOUND_File} ${filePath}`);
  }

  const xmlContent = fs.readFileSync(filePath, Constant.Common.UTF8);
  try {
    const result = await parseStringPromise(xmlContent);

    return result;
  } catch (err) {
    throw new Error(`${Constant.Messages.MSG_ERR_CONVERTING_POM_XML_FILE_TO_OBJECT} ${err}`);
  }
};

/**
 * Kiểm tra xem một node có khớp với giá trị được cung cấp hay không.
 * @param {any} node - Node cần kiểm tra.
 * @param {string[]} keyList - Danh sách các khóa để so sánh.
 * @param {any} value - Giá trị cần so sánh với node.
 * @returns {boolean} - `true` nếu node khớp với giá trị, ngược lại là `false`.
 * @remarks
 *    - Hàm so sánh các giá trị trong `keyList` giữa `node` và `value`.
 *    - Nếu `node` và `value` đều là đối tượng, kiểm tra từng khóa trong `keyList`.
 *    - Nếu `node` hoặc `value` không phải là đối tượng, trả về `false`.
 */
const isMatchNode = (node: any, keyList: string[], value: any): boolean => {
  if (typeof node === Constant.ValidateType.OBJECT && typeof value === Constant.ValidateType.OBJECT) {
    return keyList.every((key) => node[key]?.[0] === value[key]?.[0]);
  }

  return false;
};

/**
 * Tìm một node trong danh sách node dựa trên các khóa và giá trị được cung cấp.
 * @param {any[]} nodeList - Danh sách các node cần tìm kiếm.
 * @param {string[]} keyList - Danh sách các khóa để xác định node.
 * @param {any} value - Giá trị cần so sánh với các node.
 * @returns {any} - Node khớp với giá trị, hoặc `undefined` nếu không tìm thấy.
 * @remarks
 *    - Hàm duyệt qua danh sách `nodeList` và sử dụng `isMatchNode` để kiểm tra từng node.
 *    - Nếu tìm thấy node khớp, trả về node đó và thoát khỏi vòng lặp.
 */
const findNodeByKeyAndValue = (nodeList: any[], keyList: string[], value: any): any => {
  let matchNode = undefined;
  for (const element of nodeList) {
    if (isMatchNode(element, keyList, value)) {
      matchNode = element;
      break;
    }
  }

  return matchNode;
};

/**
 * Lấy danh sách node tại một đường dẫn cụ thể trong đối tượng XML, hoặc tạo mới nếu không tồn tại.
 * @param {any} xmlObject - Đối tượng XML.
 * @param {string[]} path - Danh sách có thứ tự các node cha tới node cần lấy/ tạo.
 *    Ví dụ: ['build','plugins','plugin']
 *    * Ghi chú: Thứ tự các node trong path là thứ tự từ node cha đến node cần lấy/ tạo.
 * @returns Array - là một mảng chứa giá trị của các node cần lấy/ tạo
 *    * Ghi chú: Nếu mà node cần lấy không tồn tại thì node cần lấy được tạo ra và xmlObject sẽ được thay đổi.
 * @remarks
 *    - Sử dụng `reduce` để duyệt qua các phần tử trong `path`.
 *    - Nếu node (cần tìm) không tồn tại
 *      thì node sẽ được tạo và trả về mảng chứa giá trị của các node cần lấy/ tạo
 * @example
 *   * XmlOject là objet được chuyển từ file pom.xml dưới đây:
 *      file pom.xml:
 *         <build>
 *             <plugins>
 *                 <plugin>
 *                     <groupId>org.apache.maven.plugins</groupId>
 *                     <artifactId>maven-surefire-plugin</artifactId>
 *                 </plugin>
 *                 <plugin>
 *                     <groupId>junit</groupId>
 *                     <artifactId>junit</artifactId>
 *                 </plugin>
 *             </plugins>
 *         </build>
 *
 *    Ví dụ:
 *    * getOrCreateNodeListByPath (XmlObjet,['build','plugins','plugin'])
 *       => Kết quả trả về là một mảng chứa giá trị của các node plugin trong node build/plugins.
 *         [{groupId: ['org.apache.maven.plugins'], artifactId : ['maven-surefire-plugin']},
 *          {groupId: ['junit'], artifactId: ['junit']} ]
 *      => XmlObject không thay đổi.
 *
 *   * getOrCreateNodeListByPath (XmlObjet,['build','testSourceDirectory'])
 *      => Kết quả trả về là một mảng chứa giá trị của node testSourceDirectory trong node build.
 *         Giá trị trong node testSourceDirectory là rỗng: []
 *      => XmlObject thay đổi như sau:
 *         <build>
 *             <plugins>
 *                 <plugin>
 *                     <groupId>org.apache.maven.plugins</groupId>
 *                     <artifactId>maven-surefire-plugin</artifactId>
 *                 </plugin>
 *                 <plugin>
 *                     <groupId>junit</groupId>
 *                     <artifactId>junit</artifactId>
 *                 </plugin>
 *             </plugins>
 *             <testSourceDirectory></testSourceDirectory>
 *         </build>
 */
const getOrCreateNodeListByPath = (xmlObject: any, path: string[]): [] => {
  return path.reduce((currentNode, key) => {
    if (Array.isArray(currentNode)) {
      currentNode = currentNode[0] ??= {};
    }
    currentNode[key] ??= [];

    return currentNode[key];
  }, xmlObject);
};

/**
 * Thêm một node mới vào danh sách node.
 * @param {any[]} nodeList - Danh sách node hiện tại, nơi node mới sẽ được thêm vào.
 * @param {any} value - Node mới cần thêm, có thể là một chuỗi hoặc một đối tượng.
 * @throws {Error} - Ném lỗi nếu `nodeList` không tồn tại.
 * @remarks
 *     - Nếu `nodeList` không tồn tại thì sẽ ném lỗi.
 *     - Nếu `value` là một chuỗi:
 *         + Thay thế phần tử đầu tiên trong danh sách bằng giá trị chuỗi này.
 *     - Nếu `value` là một đối tượng:
 *         + Thêm đối tượng vào cuối danh sách.
 * @example
 *     ví dụ file pom.xml:
 *     <build>
 *         <plugins>
 *             <plugin>
 *                 <groupId>org.apache.maven.plugins</groupId>
 *                 <artifactId>maven-surefire-plugin</artifactId>
 *             </plugin>
 *         </plugins>
 *         <testSourceDirectory>src/test/java</testSourceDirectory>
 *     </build>
 *
 *     1. Trường hợp value là object:
 *         addNode( plugin , { groupId: ['junit'], artifactId: ['junit']} )
 *
 *     => file pom.xml:
 *         <build>
 *             <plugins>
 *                 <plugin>
 *                     <groupId>org.apache.maven.plugins</groupId>
 *                     <artifactId>maven-surefire-plugin</artifactId>
 *                 </plugin>
 *                 <plugin>
 *                     <groupId>junit</groupId>
 *                     <artifactId>junit</artifactId>
 *                 </plugin>
 *             </plugins>
 *             <testSourceDirectory>src/test/java</testSourceDirectory>
 *         </build>
 *
 *     2. Trường hợp value là string:
 *         addNode( testSourceDirectory , "folderTest" )
 *
 *     => file pom.xml:
 *         <build>
 *             <plugins>
 *                 <plugin>
 *                     <groupId>org.apache.maven.plugins</groupId>
 *                     <artifactId>maven-surefire-plugin</artifactId>
 *                 </plugin>
 *             </plugins>
 *             <testSourceDirectory>folderTest</testSourceDirectory>
 *         </build>
 */
export const addNode = (nodeList: any[], value: any) => {
  if (!nodeList) {
    throw new Error(Constant.Messages.MSG_ERR_NODE_LIST_NOT_EXIST);
  }

  if (typeof value === Constant.ValidateType.STRING) {
    nodeList[0] = value;

    return;
  }

  // object
  nodeList.push(value);
};

/**
 * Ghi nội dung XML đã cập nhật vào tệp.
 * @param {string} pathFile - Đường dẫn đến tệp XML cần ghi.
 * @param {any} XmlObject - Đối tượng XML đã được chỉnh sửa.
 * @returns {Promise<void>} - Không trả về giá trị.
 * @remarks
 *    - Hàm sử dụng `xml2js.Builder` để chuyển đổi đối tượng XML thành chuỗi XML.
 *    - Nội dung XML được ghi vào tệp bằng `fs.writeFileSync`.
 */
const writeXMLFile = async (pathFile: string, XmlObject: any): Promise<void> => {
  const builder = new Builder();
  const updatedXml = builder.buildObject(XmlObject);
  fs.writeFileSync(pathFile, updatedXml, Constant.Common.UTF8);
};
