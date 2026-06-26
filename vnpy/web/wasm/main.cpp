#include <QApplication>
#include "mainwindow.h"

int main(int argc, char* argv[]) {
    // Qt WASM: enable high-DPI, set OpenGL to desktop
    QCoreApplication::setAttribute(Qt::AA_EnableHighDpiScaling);

    QApplication app(argc, argv);
    app.setApplicationName("VeighNa Trader");
    app.setApplicationVersion("4.4.0");

    MainWindow window;
    window.show();

    return app.exec();
}
